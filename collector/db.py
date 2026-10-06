"""Minimal Postgres client (Neon or any Postgres): upsert and select, nothing else.

Needs DATABASE_URL, e.g. postgresql://user:pass@ep-xxx.ap-southeast-2.aws.neon.tech/forecasting?sslmode=require
"""
import os

import psycopg
from psycopg import sql


class DB:
    def __init__(self, url=None):
        # prepare_threshold=None: safe behind Neon's connection pooler
        self.conn = psycopg.connect(url or os.environ["DATABASE_URL"], autocommit=False, prepare_threshold=None)

    def upsert(self, table, rows, on_conflict, returning=False):
        if not rows:
            return []
        cols = list(rows[0].keys())
        keys = [c.strip() for c in on_conflict.split(",")]
        updates = [c for c in cols if c not in keys]
        q = sql.SQL("insert into {t} ({c}) values ({v}) on conflict ({k}) do {u}").format(
            t=sql.Identifier(table),
            c=sql.SQL(", ").join(map(sql.Identifier, cols)),
            v=sql.SQL(", ").join(sql.Placeholder() * len(cols)),
            k=sql.SQL(", ").join(map(sql.Identifier, keys)),
            u=sql.SQL("update set ") + sql.SQL(", ").join(
                sql.SQL("{0} = excluded.{0}").format(sql.Identifier(c)) for c in updates)
            if updates else sql.SQL("nothing"),
        )
        with self.conn.cursor() as cur:
            cur.executemany(q, [[r.get(c) for c in cols] for r in rows])
        self.conn.commit()
        if returning:
            return self.select(table)
        return []

    def select(self, table, columns="*"):
        with self.conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(sql.SQL("select {} from {}").format(
                sql.SQL(columns) if columns == "*" else sql.SQL(", ").join(map(sql.Identifier, columns.split(","))),
                sql.Identifier(table)))
            return cur.fetchall()
