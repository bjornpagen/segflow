# Segflow: Zero to Hero Guide

## What is Segflow?

Segflow lets you write marketing automation flows in pure code. Instead of clicking through complex UIs, you can:
- Define user segments with SQL queries
- Write campaign logic in TypeScript
- Create email templates in React
- Deploy everything with Git

Think "Infrastructure as Code", but for marketing automation.

## FAQs

**Q: How often do campaigns run?**  
A: Campaigns run in real-time. As soon as a user enters a segment, they start receiving the campaign. For `dynamic` campaigns, users exit immediately when they no longer match the segment criteria.

**Q: How do you prevent duplicate sends?**  
A: Segflow tracks each user's progress through campaigns in its database. Users can only be at one step in a campaign at a time.

**Q: What databases are supported?**  
A: Segflow uses MySQL to track its own state. Your application can use any database - you just need to send user events to Segflow via its API.

**Q: What email providers are supported?**  
A: Currently Postmark and Amazon SES. Adding new providers is straightforward through the open-source codebase.

## 5-Minute Quick Start

Let's build a simple winback campaign that emails users who haven't logged in recently, with exponential backoff between attempts.

### 1. Install Segflow
```bash
bun install segflow
```

### 2. Create a minimal config
```typescript
// segflow.config.ts
import type { SegflowConfig } from 'segflow';
import { eq, sql } from 'drizzle-orm';

// Define your user properties
interface UserAttributes {
  email: string;
  name: string;
  lastLoginAt: string;
}

const config: SegflowConfig<UserAttributes> = {
  emailProvider: {
    config: {
      name: "postmark",
      apiKey: process.env.POSTMARK_API_KEY!
    },
    fromAddress: "hello@example.com"
  },

  // Define email templates with React
  templates: {
    'winback': {
      subject: (user) => `We miss you ${user.name}!`,
      component: ({ user }) => (
        <div>
          <h1>Come back and visit us!</h1>
          <p>Hi {user.name}, we noticed you haven't logged in since {user.lastLoginAt}</p>
        </div>
      )
    }
  },

  // Define user segments with SQL
  segments: {
    'inactive-users': {
      evaluator: (db) => db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(sql`${schema.users.attributes}->>'$.lastLoginAt' < NOW() - INTERVAL 30 DAY`)
    }
  },

  // Define campaign logic with TypeScript
  campaigns: {
    'winback-campaign': {
      segments: ['inactive-users'],
      behavior: 'dynamic',  // Auto-exits when user becomes active again
      flow: function* (ctx, rt) {
        // Send 10 emails with exponential backoff
        for (let i = 0; i < 10; i++) {
          yield rt.sendEmail('winback');
          yield rt.wait({ days: 2 ** i }); // Wait 1, 2, then 4 days
        }
      }
    }
  }
};

export default config;
```

### 3. Deploy your automation
```bash
bun segflow push
```

### 4. Track user activity
```typescript
import { Client } from 'segflow/client';

const client = await Client.initialize({
  url: 'http://localhost:3000',
  apiKey: 'your-api-key'
});

// Create/update users
await client.createUser('user123', {
  email: 'jane@example.com',
  name: 'Jane',
  lastLoginAt: new Date().toISOString()
});

// Track events
await client.emit('user123', 'login');
```

That's it! Segflow will automatically:
1. Identify users who haven't logged in for 30+ days
2. Add them to the winback campaign
3. Send emails with increasing delays
4. Remove users from the campaign if they log in again

## Key Concepts

### Segments = SQL Queries
Define user groups with the full power of SQL:
```typescript
segments: {
  'big-spenders': {
    evaluator: (db) => db
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.events, eq(schema.events.userId, schema.users.id))
      .where(eq(schema.events.name, 'purchase'))
      .groupBy(schema.users.id)
      .having(sql`sum(${schema.events.attributes}->'$.amount') > 1000`)
  }
}
```

### Campaigns = Generator Functions
Write complex flows with regular TypeScript:
```typescript
campaigns: {
  'onboarding': {
    segments: ['new-users'],
    behavior: 'static',
    flow: function* (ctx, rt) {
      yield rt.sendEmail('welcome');
      yield rt.wait({ days: 1 });
      
      if (!ctx.user.profileCompleted) {
        yield rt.sendEmail('complete-profile-reminder');
      }
      
      yield rt.wait({ days: 3 });
      yield rt.sendEmail('feature-highlights');
    }
  }
}
```

### Templates = React Components
Design emails with familiar tools:
```tsx
templates: {
  'welcome': {
    subject: (user) => `Welcome ${user.name}!`,
    component: ({ user }) => (
      <Html>
      <Head />
        <Tailwind>
          <Body>
            <Preview className="text-blue-600">Welcome aboard!</Preview>
            <Text className="text-slate-600">Thanks for joining us {user.name}!</Text>
            <Button href="https://example.com/get-started">
              Get Started
            </Button>
          </Body>
        </Tailwind>
      </Html>
    )
  }
}
```

## Transactions = Event-Triggered Emails

While campaigns are for ongoing flows, transactions are for immediate, event-triggered emails. Think order confirmations, password resets, or welcome emails that need to go out right when something happens:
```tsx
transactions: {
  'purchase-confirmation': {
    event: 'purchase',  // Triggered when 'purchase' event is emitted
    subject: (user) => `Order Confirmed, ${user.name}!`,
    component: ({ user }) => (
      <Html>
        <Head />
        <Tailwind>
          <Body>
            <Preview>Thanks for your order!</Preview>
            <Text className="text-slate-600">Hi {user.name}, we've received your purchase.</Text>
          </Body>
        </Tailwind>
      </Html>
    )
  },
  'password-reset': {
    event: 'reset_password_requested',
    subject: (user) => `Reset Your Password`,
    component: ({ user, event }) => (
      <Html>
        <Head />
        <Tailwind>
          <Body>
            <Preview>Reset your password</Preview>
            <Text className="text-slate-600">Click the link below to reset your password:</Text>
            <Button href={event.attributes.resetLink}>
              Reset Password
            </Button>
          </Body>
        </Tailwind>
      </Html>
    )
  }
}
```

To trigger a transactional email, just emit the corresponding event:

```typescript
// This will instantly send the purchase confirmation email
await client.emit('user123', 'purchase', {
  orderId: 'ord_123',
  amount: 99.99
});

// This will instantly send the password reset email
await client.emit('user123', 'reset_password_requested', {
  resetLink: 'https://example.com/reset/abc123'
});
```

The key differences between transactions and campaigns:
1. **Timing**: Transactions send immediately when events occur, campaigns run based on segments
2. **Repetition**: Transactions send once per event, campaigns can have multiple steps
3. **Purpose**: Transactions are for immediate responses to user actions, campaigns are for ongoing engagement

