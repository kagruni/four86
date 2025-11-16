# Docker Setup for Four86

This project uses Docker with Bun to isolate the development environment and prevent environment variable conflicts between Next.js and Convex.

## Prerequisites

- Docker Desktop installed and running
- Docker Compose (included with Docker Desktop)

## Quick Start

### 1. Create your environment file

Make sure you have a `.env.local` file in the project root with all necessary environment variables:

```bash
# Example .env.local structure
CONVEX_DEPLOYMENT=your-deployment-url
NEXT_PUBLIC_CONVEX_URL=your-public-convex-url
CLERK_SECRET_KEY=your-clerk-secret
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your-clerk-publishable-key
# Add any other environment variables your app needs
```

### 2. Start the development environment

```bash
# Using npm
npm run docker:up

# Or using bun
bun run docker:up

# Or directly with docker-compose
docker-compose up
```

This will start two isolated containers:
- **nextjs**: Your Next.js development server on port 3000 (using Bun)
- **convex**: Your Convex development server (using Bun)

### 3. Stop the environment

```bash
docker-compose down
```

## Useful Commands

### Build and start containers in detached mode
```bash
npm run docker:up:d
# or: bun run docker:up:d
# or: docker-compose up -d
```

### View logs
```bash
npm run docker:logs
# or: bun run docker:logs
# or: docker-compose logs -f

# Specific service
docker-compose logs -f nextjs
docker-compose logs -f convex
```

### Restart a specific service
```bash
docker-compose restart nextjs
docker-compose restart convex
```

### Rebuild containers (after dependency changes)
```bash
npm run docker:build
# or: bun run docker:build
# or: docker-compose up --build
```

### Stop and remove containers
```bash
npm run docker:down
# or: bun run docker:down
# or: docker-compose down
```

### Stop and remove containers + volumes
```bash
npm run docker:clean
# or: bun run docker:clean
# or: docker-compose down -v
```

## Accessing the Application

- **Next.js App**: http://localhost:3000
- Both services share the same network, so they can communicate with each other

## Environment Variable Isolation

Each service runs in its own isolated container with its own environment variables loaded from `.env.local`. This prevents the Convex CLI from overwriting environment variables that might affect your Next.js application.

## Troubleshooting

### Port already in use
If port 3000 is already in use, you can change it in `docker-compose.yml`:
```yaml
ports:
  - "3001:3000"  # Maps host port 3001 to container port 3000
```

### Hot reload not working
The development setup includes volume mounts for hot reloading. If changes aren't reflected:
1. Make sure Docker has file system access permissions
2. Try restarting the containers: `docker-compose restart`

### Convex connection issues
Make sure your `.env.local` file contains the correct Convex deployment URL and that the convex container is running properly:
```bash
docker-compose logs convex
```

### Clean slate restart
If you encounter persistent issues:
```bash
docker-compose down -v
docker-compose up --build
```

## Production Build

For production, use the standalone `Dockerfile` (uses Bun for faster builds):
```bash
docker build -t four86-prod .
docker run -p 3000:3000 --env-file .env.local four86-prod
```

## Notes

- Uses **Bun** runtime for faster dependency installation and execution
- `node_modules` and `.next` are kept in Docker volumes for better performance
- Source code changes are synced in real-time via volume mounts
- Each service maintains its own isolated environment
- Bun's built-in package manager is significantly faster than npm/yarn
