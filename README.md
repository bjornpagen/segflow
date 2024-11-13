# Segflow

An open-source, self-hosted, full-code alternative to Customer.io.

## Introduction

Segflow puts the full power of code into your marketing automation. No more fighting with clunky UIs or platform limitations – write your user engagement logic in pure TypeScript and SQL (Drizzle ORM), exactly how you want it.

Want to trigger emails based on complex customer segments? Need to run win-back campaigns with exponential backoff? Build multi-stage campaigns with loops and conditionals? While other platforms like Customer.io force you into rigid workflows, Segflow gives you the turing-completeness of code.

Also, no more drag and drop builders! Write your emails in React Email + Tailwind, just like your React components. Get pixel-perfect designs with the tools your designer already knows. Want AI to write your emails? Now it can output actual code, not just marketing copy.

Deploy your marketing automation just like you deploy your application code. One command (`segflow push`) and your campaigns are live. No separate deployment pipeline, no configuration drift, no surprises.

Because the best marketing automation is the one you can actually program.

## Quick Example

Here's a glimpse of what you can achieve with Segflow:

```typescript
// segflow.config.ts
import type { SegflowConfig, UserContext, Runtime } from 'segflow';
import * as schema from 'segflow/schema';
import { eq, sql, and } from 'drizzle-orm';

// Import email templates
import WelcomeEmailTemplate from './emails/WelcomeEmailTemplate';
import WinbackEmailTemplate from './emails/WinbackEmailTemplate';
import PurchaseConfirmationTemplate from './emails/PurchaseConfirmationTemplate';
import VIPEmailTemplate from './emails/VIPEmailTemplate';

// Define user attributes
export interface MyUserAttributes {
  username: string;
  email: string;
  winback?: boolean;
}

// Segflow configuration
const config: SegflowConfig<MyUserAttributes> = {
  emailProvider: {
    config: {
      name: 'postmark',
      apiKey: process.env.POSTMARK_API_KEY!,
    },
    fromAddress: 'hello@segflow.io',
  },
  templates: {
    'welcome-email': {
      subject: (user) => `Welcome to Segflow, ${user.username}!`,
      component: WelcomeEmailTemplate,
    },
    'winback-email': {
      subject: (user) => `We miss you, ${user.username}!`,
      component: WinbackEmailTemplate,
    },
    'vip-email': {
      subject: (user) => `You're one of our VIP customers, ${user.username}!`,
      component: VIPEmailTemplate,
    },
  },
  segments: {
    'all-users': {
      evaluator: (db) => db.select({ id: schema.users.id }).from(schema.users),
    },
    'purchased-users': {
      evaluator: (db) =>
        db
          .select({ id: schema.users.id })
          .from(schema.users)
          .innerJoin(schema.events, eq(schema.events.userId, schema.users.id))
          .where(eq(schema.events.name, 'purchase'))
          .groupBy(schema.users.id),
    },
    'big-spenders': {
      evaluator: (db) =>
        db
          .select({ id: schema.users.id })
          .from(schema.users)
          .innerJoin(schema.events, eq(schema.events.userId, schema.users.id))
          .where(eq(schema.events.name, 'purchase'))
          .groupBy(schema.users.id)
          .having(
            sql`sum(${schema.events.attributes}->'$.value') > 1000`,
          ),
    },
    'winback-eligible': {
      evaluator: (db) =>
        db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(sql`${schema.users.attributes}->'$.winback' = true`),
    },
  },
  campaigns: {
    'welcome-campaign': {
      segments: ['all-users'],
      behavior: 'static',
      flow: function* (ctx: UserContext<MyUserAttributes>, rt: Runtime) {
        yield rt.sendEmail('welcome-email');
      },
    },
    'winback-campaign': {
      segments: ['winback-eligible'],
      behavior: 'dynamic',
      flow: function* (ctx: UserContext<MyUserAttributes>, rt: Runtime) {
        for (let i = 0; i < 8; i++) {
          yield rt.sendEmail('winback-email');
          yield rt.wait({ days: 2 ** i });
        }
      },
    },
    'vip-treatment': {
      segments: ['big-spenders'],
      behavior: 'dynamic',
      flow: function* (ctx: UserContext<MyUserAttributes>, rt: Runtime) {
        while (true) {
          yield rt.sendEmail('vip-email');
          yield rt.wait({ days: 30 });
        }
      },
    },
  },
  transactions: {
    purchase: {
      event: 'purchase',
      subject: (user) => `Order Confirmed, ${user.username}!`,
      component: PurchaseConfirmationTemplate,
    },
  },
};

export default config;
```

## Features

- **Full-Code Configuration**: Define user attributes, segments, and campaigns directly in code.
- **Self-Hosted**: Maintain complete control over your data and infrastructure.
- **Powerful Segmentation**: Use custom queries for precise user segmentation.
- **Transactional Emails**: Send personalized emails based on user events.
- **Flexible Campaigns**: Design static or dynamic campaigns with custom flows.
- **Extensible Templates**: Create email templates using React components.
- **Command-Line Interface**: Manage Segflow with ease using the `segflow` CLI.

## Getting Started

### Installation

Install Segflow in your project:

```bash
bun install segflow
```

### Configuration

Create a `segflow.config.ts` file in your project's root directory:

```typescript
// segflow.config.ts
import type { SegflowConfig, UserContext, Runtime } from 'segflow';
import { users } from './schema';
import { eq } from 'drizzle-orm';

// Import email templates
import WelcomeEmailTemplate from './emails/WelcomeEmailTemplate';
import PasswordResetEmailTemplate from './emails/PasswordResetEmailTemplate';
import AccountDeactivationEmailTemplate from './emails/AccountDeactivationEmailTemplate';

// Define user attributes
export interface MyUserAttributes {
  username: string;
  email: string;
  deactivated?: boolean;
}

// Segflow configuration
const config: SegflowConfig<MyUserAttributes> = {
  emailProvider: {
    config: {
      name: 'postmark',
      apiKey: process.env.POSTMARK_API_KEY!,
    },
    fromAddress: 'hello@segflow.io',
  },
  templates: {
    'welcome-email': {
      subject: (user) => `Welcome to YourApp, ${user.username}!`,
      component: WelcomeEmailTemplate,
    },
    'password-reset-email': {
      subject: (user) => `Reset Your Password, ${user.username}`,
      component: PasswordResetEmailTemplate,
    },
  },
  segments: {
    'all-users': {
      evaluator: (db) => db.select({ id: users.id }).from(users),
    },
  },
  campaigns: {
    'welcome-campaign': {
      segments: ['all-users'],
      behavior: 'static',
      flow: function* (ctx: UserContext<MyUserAttributes>, rt: Runtime) {
        yield rt.sendEmail('welcome-email');
      },
    },
  },
};

export default config;
```

### Defining User Attributes

Define the structure of your user attributes:

```typescript
export interface MyUserAttributes {
  username: string;
  email: string;
  deactivated?: boolean;
}
```

### Setting Up Email Templates

Place your email templates in the `emails/` directory. Segflow uses React Email + Tailwind, giving you the full power of React components and modern CSS for your email designs.

#### Welcome Email Template

```typescript
// emails/WelcomeEmailTemplate.tsx
import React from 'react';
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Tailwind,
  Button,
} from '@react-email/components';
import type { MyUserAttributes } from '../segflow.config';

const WelcomeEmailTemplate: React.FC<{ user: MyUserAttributes }> = ({ user }) => (
  <Html>
    <Head />
    <Preview>Welcome to our platform!</Preview>
    <Tailwind>
      <Body className="bg-white my-auto mx-auto font-sans px-2">
        <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px]">
          <Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
            Welcome to our platform, {user.username}!
          </Heading>
          <Text className="text-black text-[14px] leading-[24px]">
            We're excited to have you on board.
          </Text>
          <Section className="text-center mt-[32px] mb-[32px]">
            <Button 
              className="bg-[#000000] rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
              href="https://your-platform.com/get-started"
            >
              Get Started
            </Button>
          </Section>
        </Container>
      </Body>
    </Tailwind>
  </Html>
);

export default WelcomeEmailTemplate;
```

Your email templates are just React components that receive user attributes as props. Use React Email's components for email-safe markup, and style them with Tailwind CSS.

For more examples and components, check out the [React Email documentation](https://react.email/docs/introduction).

#### Password Reset Email Template

```typescript
// emails/PasswordResetEmailTemplate.tsx
import React from 'react';
import { Body, Container, Heading, Text, Button } from '@react-email/components';
import type { MyUserAttributes } from '../segflow.config';

const PasswordResetEmailTemplate: React.FC<{ user: MyUserAttributes }> = ({ user }) => (
  <Body>
    <Container>
      <Heading>Password Reset Request</Heading>
      <Text>Hello {user.username},</Text>
      <Text>Click the button below to reset your password.</Text>
      <Button href={`https://yourapp.com/reset-password?token=${user.passwordResetToken}`}>
        Reset Password
      </Button>
    </Container>
  </Body>
);

export default PasswordResetEmailTemplate;
```

### Using the Client SDK

Interact with your users and events using the Segflow client SDK.

#### Initializing the Client

```typescript
import { Client } from 'segflow/client/sdk';

const client = new Client({
  url: 'https://your-segflow-instance.com',
  apiKey: 'your-api-key',
});
```

#### Creating Users

```typescript
await client.createUser('user-123', {
  username: 'johndoe',
  email: 'john@example.com',
});
```

#### Updating Users

```typescript
await client.updateUser('user-123', {
  deactivated: true,
});
```

#### Emitting Events

```typescript
await client.emit('user-123', 'login', {
  timestamp: Date.now(),
});
```

### Database Schema

Your user and event data is stored in a database. Segflow uses Drizzle ORM with MySQL, giving you the full power of SQL for user segmentation and campaign orchestration.

#### Core Tables

- **Users**: Stores user profiles with JSON attributes
  ```typescript
  users: {
    id: string;
    attributes: { email: string; /* your custom fields */ };
  }
  ```

- **Events**: Tracks user activities with timestamps and JSON payloads
  ```typescript
  events: {
    id: number;
    name: string;        // e.g., "purchase", "login"
    userId: string;
    createdAt: Date;
    attributes: Record<string, any>;  // e.g., { value: 99.99 }
  }
  ```

#### Campaign Management

- **Segments**: Defines user groups using SQL queries
- **Campaigns**: Stores campaign logic as executable flows
- **Campaign States**: Tracks where each user is in each campaign
  - Supports states like "pending", "sleeping", "running"
  - Records execution history for debugging

#### Advanced Features

- **Segment Triggers**: Automatically evaluate segments on events or schedules
- **Campaign Exclusions**: Prevent users from entering specific campaigns
- **Transaction Templates**: Handle one-off events like purchase confirmations

All tables use Drizzle ORM, so you can write type-safe queries with full SQL power:

```typescript
// Example: Find users who spent over $1000
db.select({ id: schema.users.id })
  .from(schema.users)
  .innerJoin(schema.events, eq(schema.events.userId, schema.users.id))
  .where(eq(schema.events.name, 'purchase'))
  .groupBy(schema.users.id)
  .having(sql`sum(${schema.events.attributes}->'$.value') > 1000`)
```

Check `segflow/schema` for the complete database schema.

## Understanding Campaigns

Campaigns in Segflow are defined using generator functions, allowing you to script complex user flows with ease.

### Static vs. Dynamic Campaigns

- **Static Campaigns**: Users enter the campaign once and progress through the flow without re-entering.
- **Dynamic Campaigns**: Users enter the campaign once, but as soon as they stop meeting the segment criteria, they are removed from the campaign. (TODO: users will be added back in when they meet the segment criteria again)

### Example: Welcome Campaign

```typescript
campaigns: {
  'welcome-campaign': {
    segments: ['all-users'],
    behavior: 'static',
    flow: function* (ctx, rt) {
      yield rt.sendEmail('welcome-email');
      yield rt.wait({ days: 1 });
      yield rt.sendEmail('tips-email');
    },
  },
},
```

### Example: Re-Engagement Campaign

```typescript
campaigns: {
  'reengagement-campaign': {
    segments: ['inactive-users'],
    behavior: 'dynamic',
    flow: function* (ctx, rt) {
      while (true) {
        yield rt.sendEmail('we-miss-you-email');
        yield rt.wait({ days: 7 });
      }
    },
  },
},
```

## Using the Command-Line Interface

Manage your Segflow configurations, users, and events using the `segflow` CLI.

### Installation

Make the script executable:

```bash
bun install segflow
```

Run the script using:

```bash
bun segflow
```

### Usage

```bash
Usage:
  segflow push [config-path]                    Push config to server (defaults to ./segflow.config.ts)
  segflow emit <event> <user-id> [attributes]   Emit event with attributes
  segflow add <user-id> [attributes]            Add or update user with attributes

Attribute formats:
  1. Key-value pairs:    username='johndoe' email='john@example.com'
  2. JSON (with -j):     -j '{"username": "johndoe", "email": "john@example.com"}'

Examples:
  segflow push
  segflow emit login user123 timestamp=1625247600
  segflow add user123 username='johndoe' email='john@example.com'
```

## CLI Configuration

The Segflow CLI can be configured using environment variables or a credentials file. The simplest way is to use environment variables in your project's `.env` file:

```env
# Required client-side environment variables
SEGFLOW_URL=http://localhost:3000     # Your Segflow instance URL
SEGFLOW_API_KEY=0xdeadbeef           # Your API key for authentication
POSTMARK_API_KEY=your-postmark-key   # If using Postmark as email provider
```

The CLI will automatically load these environment variables when executing commands. For example:

```bash
# With environment variables set, you can run commands directly
segflow push
segflow emit purchase user123 amount=99.99
```

If environment variables are not set, the CLI will fall back to looking for credentials in `~/.segflow/credentials.json`. However, using environment variables is recommended for easier development and CI/CD integration.

## Architectural Decisions

### Full-Code Configuration

Leveraging code for configurations ensures maximum flexibility and version control. Use the power of TypeScript to create complex campaigns and integrate seamlessly with your systems.

### Self-Hosting

Self-hosting grants complete control over your data, crucial for privacy compliance and data security.

### Generator Functions for Campaigns

Using generator functions allows for writing asynchronous workflows in a synchronous style, making complex campaign logic easy to understand and maintain.

### React Email Templates

Craft dynamic and reusable email templates using React, simplifying maintenance and scaling of email campaigns.

## Conclusion

Segflow empowers developers to build sophisticated marketing automation workflows tailored to their unique business needs, all while maintaining full control over their code and data.

## License

Segflow is open-source software licensed under the BSD Zero Clause License.