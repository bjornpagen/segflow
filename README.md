# Segflow: Zero to Hero Guide

## What is Segflow?

Segflow lets you write marketing automation flows in pure code. Instead of clicking through complex UIs, you can:
- Define user segments with SQL queries
- Write campaign logic in TypeScript
- Create email templates in React
- Deploy everything with Git

Think "Infrastructure as Code", but for marketing automation.

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
        // Send 3 emails with exponential backoff
        for (let i = 0; i < 3; i++) {
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
      .having(sql`sum(${schema.events.attributes}->>'$.amount') > 1000`)
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
      
      if (!ctx.hasEvent('completed_profile')) {
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
```typescript
templates: {
  'welcome': {
    subject: (user) => `Welcome ${user.name}!`,
    component: ({ user }) => (
      <EmailLayout>
        <Heading>Welcome aboard!</Heading>
        <Text>Thanks for joining us {user.name}!</Text>
        <Button href="https://example.com/get-started">
          Get Started
        </Button>
      </EmailLayout>
    )
  }
}
```

## FAQs

**Q: How often do campaigns run?**  
A: Campaigns run in real-time. As soon as a user enters a segment, they start receiving the campaign. For `dynamic` campaigns, users exit immediately when they no longer match the segment criteria.

**Q: How do you prevent duplicate sends?**  
A: Segflow tracks each user's progress through campaigns in its database. Users can only be at one step in a campaign at a time.

**Q: What databases are supported?**  
A: Segflow uses MySQL to track its own state. Your application can use any database - you just need to send user events to Segflow via its API.

**Q: What email providers are supported?**  
A: Currently Postmark and Amazon SES. Adding new providers is straightforward through the open-source codebase.

## What's Next?

- [Full Configuration Options](link-to-docs)
- [Campaign Patterns & Examples](link-to-examples)
- [Email Template Gallery](link-to-templates)
- [Contributing Guide](link-to-contributing)

How's this for a first draft? It leads with a concrete example that showcases the code-first approach, then expands into the key concepts. Let me know if you'd like me to adjust the focus or add more details in any area.