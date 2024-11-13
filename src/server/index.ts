#!/usr/bin/env bun
import { serve } from "bun"
import { createHandler } from "./handler"
import { config } from "dotenv"
import { drizzle } from "drizzle-orm/mysql2"
import type * as schema from "../shared/schema"
import { runExecutions } from "./evaluators"

config({ path: ".env" })
export const db = drizzle<typeof schema>(process.env.DATABASE_URL!)

const handler = createHandler({
	apiKey: process.env.SEGFLOW_API_KEY!,
	db
})

const server = serve({
	port: 3000,
	fetch: handler.fetch
})

console.log(`Server listening on http://localhost:${server.port}`)

// Start execution daemon
const EXECUTION_INTERVAL = 100 // 100ms

function executionDaemon() {
	runExecutions(db)
		.then((info) => {
			if (info.total > 0) {
				console.log(
					`Executed ${info.total} executions, ${info.succeeded} successes, ${info.failed} failures`
				)
			}
		})
		.catch((error) => {
			console.error("Error in execution daemon:", error)
		})
		.finally(() => {
			setTimeout(executionDaemon, EXECUTION_INTERVAL)
		})
}

// Start the first run
executionDaemon()

// Handle graceful shutdown
process.on("SIGINT", () => {
	console.log("Shutting down server...")
	process.exit(0)
})

process.on("SIGTERM", () => {
	console.log("Shutting down server...")
	process.exit(0)
})
