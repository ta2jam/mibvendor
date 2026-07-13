# Vendor permission operations

The first-wave tracker contains the ten vendors in the owner action register.
Every request asks for five independent scopes. A public download, a general
site permission, silence, or approval of one scope does not activate another.

Render a reviewed draft from an accountable identity without committing that
identity to Git:

```sh
MIBVENDOR_OWNER_NAME='...' \
MIBVENDOR_OWNER_ROLE='...' \
MIBVENDOR_OWNER_EMAIL='...' \
node scripts/render-rights-request.mjs cisco
```

Before changing a request from `not_sent`, record the actual recipient and ISO
timestamp. Before changing any scope from `unknown`, retain the complete vendor
response in controlled storage and record its immutable evidence reference.
Run `npm run check:rights-requests` after each update. The validator rejects
scope decisions without a response and sent claims without recipient/time.

The tracker is public and must not contain private correspondence, personal
phone numbers, account credentials, or proprietary MIB text.
