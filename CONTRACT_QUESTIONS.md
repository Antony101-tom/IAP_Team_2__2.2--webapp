# CONTRACT_QUESTIONS.md

1. Authentication is completely undocumented
No security scheme, no API key, no auth header anywhere in the spec. Is this API open to anyone, or does it require a key/token that just wasn't documented? Critical gap for a real integration.

2. verified and verification can disagree
verification is only "present when verified is true" with no guarantee it is. Can verified: true occur with no verification object?

3. No rate limiting information
Nothing about request limits per minute/hour — worth knowing if Meditrac plans to hit GET /artisans frequently for catalog refreshes.
