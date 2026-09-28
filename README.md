# Medisetu Clinic Management Software (CMS) - Backend

The backend system for the Medisetu Clinic Management Software, built with Node.js, Express, and TypeScript. It handles core business logic for clinic operations, including appointments, pharmacy, laboratory services, and real-time notifications.

## 🚀 Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express.js
- **ORM**: Drizzle ORM
- **Database**: PostgreSQL
- **Caching & Queue**: Redis
- **Message Broker**: Apache Kafka (for event-driven notifications)
- **Real-time Communication**: Socket.io
- **Validation**: Zod
- **Documentation**: Swagger (OpenAPI)
- **Containerization**: Docker & Docker Compose

## 🛠️ Key Features

- **Clinic & Doctor Management**: Handle clinic details, doctor schedules, and availability.
- **Appointment System**: Create, reschedule, cancel, and track appointment history.
- **Pharmacy Module**: Inventory management, medicine stock tracking, and invoice generation.
- **Laboratory Services**: Manage lab tests, assignments, and report uploads.
- **Real-time Notifications**: Multi-channel notifications via Kafka and WebSockets.
- **User & Subscription Management**: Role-based access control (RBAC) and subscription plans.
- **File Uploads**: Integration with Cloudinary and AWS S3 for documents and images.

## 🏁 Getting Started

### Prerequisites

Ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/)
- [PostgreSQL](https://www.postgresql.org/) (if not using Docker for DB)

### Installation

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd cms_backend
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Setup environment variables**:
    Copy the example environment file and fill in the required values.
    ```bash
    cp .env.example .env
    ```

4.  **Spin up infrastructure**:
    Use Docker Compose to start Kafka, Redis, and Zookeeper.
    ```bash
    npm run dev
    ```
    *Note: This command also starts the application with nodemon.*

### Database Setup

The project uses separate migration paths for development and production to prevent local experimental migrations from being pushed to the repository.

1.  **Generate migrations**:
    - For Development: `npm run db:migrations:dev` (Stored in `src/drizzle/migrations/dev`, ignored by Git)
    - For Production: `npm run db:migrations:prod` (Stored in `src/drizzle/migrations/prod`, tracked by Git)

2.  **Run migrations**:
    - For Development: `npm run db:migrate:dev`
    - For Production: `npm run db:migrate:prod`

3.  **Seed the database** (Optional):
    - For Development: `npm run db:seed:dev`
    - For Production: `npm run db:seed:prod`

## 📖 API Documentation

The project uses Swagger for API documentation. Once the server is running, you can access it at:

- **Swagger UI**: `http://localhost:5000/api-docs`
- **JSON Spec**: `http://localhost:5000/docs/json`

## 💻 Development Workflow

- **Run in development mode**: `npm run dev`
- **Build for production**: `npm run build`
- **Linting**: `npm run lint` or `npm run lint:fix`
- **Formatting**: `npm run format`

### Pre-commit Hooks
This project uses **Husky** to ensure code quality. Before every commit, Prettier and ESLint are automatically run on staged files.

## 📁 Project Structure

```text
src/
├── configurations/ # Database, Redis, Cloudinary configs
├── drizzle/        # Database schemas, migrations, and seeds
├── htmltamplates/  # Email and API HTML templates
├── kafka/          # Kafka producers, consumers, and managers
├── main/           # Core modules (Appointments, Clinic, Doctor, etc.)
│   └── [module]/
│       ├── controllers/
│       ├── models/
│       ├── routes/
│       ├── schemas/
│       └── services/
├── middlewear/     # Custom Express middlewares
├── socket/         # Socket.io event handling
├── utils/          # Shared utilities and helpers
├── app.ts          # Express app initialization
└── server.ts       # Server entry point
```

## 🐳 Docker Deployment

To build and run the entire stack using Docker:

```bash
npm run docker:up
```

To stop the containers:

```bash
npm run docker:down
```

## 📜 License

This project is licensed under the [ISC License](LICENSE).
