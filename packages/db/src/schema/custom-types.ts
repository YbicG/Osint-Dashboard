import { customType } from 'drizzle-orm/pg-core'

/**
 * pgvector column type. Implemented via Drizzle's customType rather than a
 * built-in helper so this compiles against any drizzle-orm 0.3x release —
 * the pgvector extension itself is enabled in infra/init/postgres/001-extensions.sql.
 */
export const vector = (name: string, config: { dimensions: number }) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${config.dimensions})`
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`
    },
    fromDriver(value: string): number[] {
      return value
        .slice(1, -1)
        .split(',')
        .filter(Boolean)
        .map(Number)
    },
  })(name)
