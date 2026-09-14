import type { ColumnDefinitionBuilder } from 'kysely';
import type { DialectKind } from './dialects.ts';

/** Types physiques par moteur, pour des migrations écrites une seule fois. */
export interface ColumnKit {
  uuid: 'uuid' | 'text';
  bool: 'smallint' | 'integer';
  ts: 'bigint' | 'integer';
  money: 'bigint' | 'integer';
  blob: 'bytea' | 'blob';
  autoPk: { type: 'bigserial' | 'integer'; build: (col: ColumnDefinitionBuilder) => ColumnDefinitionBuilder };
}

export function columnKit(kind: DialectKind): ColumnKit {
  if (kind === 'postgres') {
    return {
      uuid: 'uuid',
      bool: 'smallint',
      ts: 'bigint',
      money: 'bigint',
      blob: 'bytea',
      // bigserial et non « generated always as identity » (PostgreSQL 10+) : o2switch sert un PostgreSQL plus ancien.
      autoPk: { type: 'bigserial', build: (col) => col.primaryKey() },
    };
  }
  return {
    uuid: 'text',
    bool: 'integer',
    ts: 'integer',
    money: 'integer',
    blob: 'blob',
    autoPk: { type: 'integer', build: (col) => col.primaryKey().autoIncrement() },
  };
}
