# Creative Variant Sheet

Standalone Next.js app for turning one product image into multiple testable creative directions.

## Local setup

1. Install dependencies:

```bash
pnpm install
```

2. Create `.env.local` from `env.template`.

3. Run the app:

```bash
pnpm dev
```

## Required environment

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CEREBRAS_API_KEY`

## Recommended environment

- `NEXT_PUBLIC_GALLERY_USER_ID`
- `GOOGLE_CLOUD_API_KEY`
- `NANO_BANANA_API_KEY`
- `GOOGLE_CLOUD_RUN_GENERATE_IMAGE_URL`
- `NEXT_PUBLIC_GOOGLE_CLOUD_RUN_GENERATE_IMAGE_URL`
- `CLOUD_RUN_SECRET_TOKEN`

## Deploy

```bash
vercel
vercel --prod
```
