import { migrate } from "../src/lib/store/postgres";

migrate()
  .then(() => console.log("Migrated STAMP postgres schema."))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
