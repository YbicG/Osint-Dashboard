"""
Vision sidecar: face detection/embedding, EXIF extraction. Called by
apps/worker's connector pipeline (image_face_embedding / image_exif claims)
— never called directly by the browser.

BIPA/CUBI consent gate: every endpoint that produces or compares a
biometric identifier (a faceprint) requires the caller to pass
`X-Biometric-Consent-Ack: true`. This service does not itself know whether
a case has the jurisdiction/consent acknowledgment the plan's compliance
layer calls for — that decision and its audit trail live in the Postgres
`case` table (apps/web) — but it refuses to do biometric work at all
without the caller explicitly asserting that check has passed, as defense
in depth against a caller that forgets. Plain image utilities that carry no
biometric-privacy weight (EXIF, health check) are not gated.
"""
import cv2
import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .exif_utils import extract_exif
from .face_engine import EMBEDDING_DIM, FaceEngine, cosine_similarity

app = FastAPI(title="OSINT Dashboard Vision Service", version="0.1.0")


def require_biometric_consent(x_biometric_consent_ack: str | None = Header(default=None)) -> None:
    if x_biometric_consent_ack != "true":
        raise HTTPException(
            status_code=403,
            detail=(
                "Missing X-Biometric-Consent-Ack: true header. The calling case must have recorded a "
                "jurisdiction/consent acknowledgment (see plan doc's biometric compliance gate) before "
                "this service will detect, embed, or compare faces."
            ),
        )


def _decode_image(raw: bytes) -> np.ndarray:
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode file as an image")
    return img


@app.get("/health")
def health():
    engine = FaceEngine.get()
    return {"status": "ok", "modelsLoaded": engine.is_loaded}


class FaceBox(BaseModel):
    bbox: list[float] = Field(description="[x1, y1, x2, y2] in pixel coordinates")
    detScore: float


class DetectResponse(BaseModel):
    faces: list[FaceBox]


@app.post("/detect", response_model=DetectResponse)
async def detect(file: UploadFile = File(...)):
    """Face detection only — no embeddings produced, no biometric identifier created, so no consent gate."""
    raw = await file.read()
    img = _decode_image(raw)
    engine = FaceEngine.get()
    faces = engine.detect(img, with_embeddings=False)
    return DetectResponse(faces=[FaceBox(bbox=f.bbox, detScore=f.det_score) for f in faces])


class EmbeddedFace(BaseModel):
    bbox: list[float]
    detScore: float
    embedding: list[float] = Field(description=f"{EMBEDDING_DIM}-dim ArcFace embedding, L2-normalized")


class EmbedResponse(BaseModel):
    faces: list[EmbeddedFace]


@app.post("/embed", response_model=EmbedResponse, dependencies=[])
async def embed(file: UploadFile = File(...), x_biometric_consent_ack: str | None = Header(default=None)):
    """Detects every face in the image and returns its 512-dim embedding — this IS biometric identifier creation, gated."""
    require_biometric_consent(x_biometric_consent_ack)
    raw = await file.read()
    img = _decode_image(raw)
    engine = FaceEngine.get()
    faces = engine.detect(img, with_embeddings=True)
    return EmbedResponse(faces=[
        EmbeddedFace(bbox=f.bbox, detScore=f.det_score, embedding=f.embedding) for f in faces
    ])


class CompareRequest(BaseModel):
    embeddingA: list[float]
    embeddingB: list[float]


class CompareResponse(BaseModel):
    cosineSimilarity: float
    isLikelyMatch: bool


# ArcFace embeddings from the same buffalo_l model: same-person pairs
# typically score well above this; this is a starting operating point, not
# a legally-calibrated threshold — treat a match here as an investigative
# lead requiring human review, never as an automated identification.
MATCH_THRESHOLD = 0.45


@app.post("/compare", response_model=CompareResponse)
def compare(req: CompareRequest, x_biometric_consent_ack: str | None = Header(default=None)):
    require_biometric_consent(x_biometric_consent_ack)
    if len(req.embeddingA) != EMBEDDING_DIM or len(req.embeddingB) != EMBEDDING_DIM:
        raise HTTPException(status_code=400, detail=f"Both embeddings must be {EMBEDDING_DIM}-dimensional")
    sim = cosine_similarity(req.embeddingA, req.embeddingB)
    return CompareResponse(cosineSimilarity=sim, isLikelyMatch=sim >= MATCH_THRESHOLD)


class ExifResponse(BaseModel):
    cameraMake: str | None
    cameraModel: str | None
    dateTaken: str | None
    software: str | None
    gps: dict | None
    width: int | None
    height: int | None
    error: str | None = None


@app.post("/exif", response_model=ExifResponse)
async def exif(file: UploadFile = File(...)):
    """Not gated — EXIF metadata isn't a biometric identifier, and image_exif claims are already just claims."""
    raw = await file.read()
    return ExifResponse(**extract_exif(raw))
