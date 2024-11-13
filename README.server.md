# Segflow Server Setup (macOS)

This guide explains how to set up and run the Segflow server on macOS.

## Prerequisites

### 1. Install MySQL
First, install MySQL using Homebrew:

```bash
brew install mysql
```

Start MySQL service and enable it to run at startup:
```bash
brew services start mysql
```

### 2. Create Database
Connect to MySQL and create the Segflow database:
```bash
mysql -u root
```

In the MySQL prompt:
```sql
CREATE DATABASE segflow;
exit;
```

## Environment Configuration

Create a `.env` file in your project root:

```env
# Required server-side environment variables
DATABASE_URL=mysql://root:@localhost:3306/segflow   # MySQL connection string
SEGFLOW_API_KEY=0xdeadbeef                         # API key for authentication
```

### Environment Variables Explained

- `DATABASE_URL`: MySQL connection string. Format: `mysql://username:password@host:port/database`
- `SEGFLOW_API_KEY`: Secret key used to authenticate API requests

## Database Setup

Initialize the database schema using Drizzle Kit:

```bash
# Install dependencies if you haven't already
bun install

# Push database schema
bun drizzle-kit push
```

This uses the configuration in `drizzle.config.ts` to set up your database tables.

## Running the Server

Start the Segflow server:

```bash
bun src/server/index.ts
```

The server will:
1. Start on port 3000
2. Connect to MySQL using the DATABASE_URL
3. Begin processing campaign executions every 100ms
4. Listen for incoming API requests

You should see output like:
```
Server listening on http://localhost:3000
```

## Troubleshooting

### MySQL Connection Issues

If you can't connect to MySQL:

1. Check if MySQL is running:
```bash
brew services list
```

2. Verify your connection string:
```bash
mysql -u root -h localhost
```

3. If you set a MySQL root password, update DATABASE_URL:
```env
DATABASE_URL=mysql://root:yourpassword@localhost:3306/segflow
```

### Port Conflicts

If port 3000 is in use:
1. Find and stop the conflicting process, or
2. Modify the port in `src/server/index.ts`

### Schema Push Failures

If `drizzle-kit push` fails:
1. Ensure MySQL is running
2. Verify DATABASE_URL is correct
3. Confirm the database exists:
```sql
mysql -u root -e "SHOW DATABASES;"
```

## Development Notes

- The server runs an execution daemon every 100ms to process campaign flows
- Graceful shutdown is handled for SIGINT and SIGTERM signals
- The server uses Bun's built-in server capabilities for HTTP handling
- Database schema is managed through Drizzle ORM

## Security Considerations

- Always use a strong SEGFLOW_API_KEY
- In production, ensure MySQL is properly secured with a password
- Consider running behind a reverse proxy for SSL termination
- Keep your `.env` file secure and never commit it to version control

## Next Steps

Once your server is running:
1. Configure your client to connect using the server's URL and API key
2. Create your first campaign configuration
3. Push the configuration using the CLI: `bun segflow push`

For client configuration and campaign creation, see the main README.md. 