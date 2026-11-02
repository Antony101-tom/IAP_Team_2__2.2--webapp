# Monitoring notes (Week 12)

> Write the two predictions in Part A BEFORE you run `traffic.js` or open `/stats`: the point is to compare
> them with the real numbers afterwards. Delete the hints in italics when you fill a section in.

## Part A: predictions (written before any data)

1. **Which endpoint will be slowest, and why?**
   _Your prediction. Hint: look at which routes do the most work per request (a search with distance maths,
   a list of every pharmacy, a call to another server) and which are a single indexed lookup._

2. **Which endpoint will produce the most errors, and why?**
   _Your prediction. Hint: think about who sends 4xx (callers' mistakes: no key, unknown id, bad input)
   versus 5xx (our faults: database down, partner down)._

## Part E: what the data shows

_Paste `/stats` output (with `<your-api-key>` in any command, never the real key) and 5 to 10 log lines
including at least one 200 and one 401. How to collect them:_

```
node server.js | tee requests.log          # in server/
KEY=<your-key> N=200 npm run traffic       # in another terminal
curl -s -H "X-API-Key: <your-api-key>" http://localhost:5000/stats
grep -c "<your-real-key>" requests.log     # must print 0
```

1. **Predicted vs actual** (with numbers):

2. **One real pattern in my traffic, with figures**
   _Example shape: "GET /api/pharmacies/:id averaged 4.1 ms but its slowest call was 38 ms, and 9 of its
   16 calls were 404s"._

3. **Why I think it happens, and what I would check next:**

4. **One alert I would want in production**
   _Pick one number from `/stats`, a threshold, and what should happen when it fires. Candidates in this
   project: `errorRatePercent` (5xx only), a route's `maxMs`, or `partner.failureRatePercent` (how often
   Find My Artisan is failing). Then: while a human is paged, what should the feature already be doing for
   users (the Week 11 fallback)?_
