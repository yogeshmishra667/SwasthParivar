# Migrations

TimescaleDB hypertable conversion runs **after** Prisma creates the table.

After `prisma migrate dev` creates `glucose_readings`, run once per environment:

```sql
SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);
```

Put this in a manual migration file (`prisma/migrations/xxxx_timescale/migration.sql`) or a bootstrap script — Prisma does not model Timescale-specific DDL.
