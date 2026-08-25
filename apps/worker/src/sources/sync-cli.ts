import '../load-env.js' // must stay the first import — see load-env.ts's doc comment
import { db } from '@osint/db'
import { syncSourceRegistry } from './sync'

syncSourceRegistry(db)
  .then(({ created, updated }) => {
    console.log(`Source registry sync complete: ${created} created, ${updated} updated.`)
    process.exit(0)
  })
  .catch((err) => {
    console.error('Source registry sync failed:', err)
    process.exit(1)
  })
