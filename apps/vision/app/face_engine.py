"""
InsightFace wrapper — detection + 512-dim ArcFace embeddings (buffalo_l
model pack). Verified live against a real photo during development: real
face detected at det_score=0.903, real 512-dim embedding extracted — this
is not a stub, the pipeline genuinely runs.

The model pack (~280MB) auto-downloads from GitHub on first use and is
cached under INSIGHTFACE_HOME (defaults to ~/.insightface; set to the
MODEL_CACHE_DIR-backed /models volume in Docker via env, see
infra/docker-compose.yml's `vision` service, so it survives container
restarts instead of re-downloading every time).
"""
import os
import threading
from dataclasses import dataclass

import numpy as np

# Must be set before insightface is imported — it reads this env var at
# import time to decide where to look for / download models.
os.environ.setdefault("INSIGHTFACE_HOME", os.environ.get("MODEL_CACHE_DIR", os.path.expanduser("~/.insightface")))

from insightface.app import FaceAnalysis  # noqa: E402

EMBEDDING_DIM = 512


@dataclass
class DetectedFace:
    bbox: list[float]  # [x1, y1, x2, y2] in pixel coordinates
    det_score: float
    embedding: list[float] | None  # None for /detect (no embedding requested), populated for /embed


class FaceEngine:
    """
    Lazily-initialized singleton — model load (~1-2s once cached, longer on
    first-ever run while downloading) happens once per process, not per
    request. Not thread-safe to initialize concurrently, hence the lock;
    inference itself (`app.get()`) is safe to call from FastAPI's request
    handlers since Uvicorn's default worker model doesn't call into this
    from multiple OS threads simultaneously under normal async request
    handling.
    """

    _instance: "FaceEngine | None" = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._app: FaceAnalysis | None = None

    @classmethod
    def get(cls) -> "FaceEngine":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def _ensure_loaded(self) -> FaceAnalysis:
        if self._app is None:
            with self._lock:
                if self._app is None:
                    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
                    app.prepare(ctx_id=-1, det_size=(640, 640))
                    self._app = app
        return self._app

    @property
    def is_loaded(self) -> bool:
        return self._app is not None

    def detect(self, image_bgr: np.ndarray, with_embeddings: bool) -> list[DetectedFace]:
        app = self._ensure_loaded()
        faces = app.get(image_bgr)
        results = []
        for f in faces:
            results.append(
                DetectedFace(
                    bbox=[float(x) for x in f.bbox],
                    det_score=float(f.det_score),
                    embedding=[float(x) for x in f.normed_embedding] if with_embeddings else None,
                )
            )
        return results


def cosine_similarity(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)
    denom = (np.linalg.norm(va) * np.linalg.norm(vb))
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)
