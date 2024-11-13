import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

config({ path: ".env" })

export default defineConfig({
	schema: "./src/shared/schema.ts",
	out: "./src/server/drizzle",
	dialect: "mysql",
	dbCredentials: {
		url: process.env.DATABASE_URL!
	}
})
