# Monitoring notes (Week 12)

> Write the two predictions in Part A BEFORE you run `traffic.js` or open `/stats`: the point is to compare
> them with the real numbers afterwards. Delete the hints in italics when you fill a section in.

## Part A: predictions (written before any data)

1. **Which endpoint will be slowest, and why?**
   GET /medications
   This is because it has no limit, so it joins every medication to its pharmacy and returns every row, and the response grows as you add stock

2. **Which endpoint will produce the most errors, and why?**
   POST /medications
   This is because to create a medication you need to have login details of a specific pharmacy, morever you should have a login token for the specific pharmacy

## Part E: what the data shows

_Paste `/stats` output (with `<your-api-key>` in any command, never the real key) and 5 to 10 log lines
including at least one 200 and one 401. How to collect them:_

```
node server.js | tee requests.log          # in server/
KEY=<your-key> N=200 npm run traffic       # in another terminal
curl -s -H "X-API-Key: <your-api-key>" http://localhost:5000/stats
grep -c "<your-real-key>" requests.log     # must print 0
```
{"time":"2026-11-02T09:38:12.152Z","method":"GET","path":"/api/pharmacies","status":200,"ms":200.7,"caller":"key-fc131b"}
{"time":"2026-11-02T09:38:12.422Z","method":"GET","path":"/api/pharmacies/00000000-0000-4000-8000-000000000000","status":404,"ms":204.9,"caller":"key-fc131b"}
{"time":"2026-11-02T09:38:12.684Z","method":"GET","path":"/api/medications/search","status":200,"ms":202.6,"caller":"key-fc131b"}
{"time":"2026-11-02T09:38:13.084Z","method":"GET","path":"/api/medications/search","status":200,"ms":338.5,"caller":"key-fc131b"}
{"time":"2026-11-02T09:38:13.545Z","method":"GET","path":"/api/medications/search","status":200,"ms":395.4,"caller":"key-fc131b"}
{"time":"2026-11-02T09:38:14.004Z","method":"GET","path":"/api/medications","status":200,"ms":405.5,"caller":"key-fc131b"}
{"time":"2026-11-02T09:38:14.061Z","method":"GET","path":"/api/pharmacies","status":401,"ms":0.6,"caller":"none"}

1. **Predicted vs actual** (with numbers):
Predicted - GET /medications
Slowest end point - GET medications/search was slowest on average (244.6 ms)

2. **One real pattern in my traffic, with figures**
   Every route that touches the database averages about 195-245 ms but its slowest call is 1.3-1.5 seconds, around 6 times its average. Requests that never reach the database take about 0.5 ms. The overall average (121.1 ms) is therefore misleading: it is pulled down by the 148 instant rejections, and the database routes alone average about 223 ms.

3. **Why I think it happens, and what I would check next:**
   A missing-pharmacy lookup finds nothing yet still takes 195 ms, so most of the time looks like a fixed cost per query, probably the round trip from my server to the hosted Supabase database, rather than the work in the SQL. The 1.3-1.5 s outliers are probably a new database connection after the connection sat idle. To test this I would (a) leave the server idle for about 10 minutes and send one request, expecting about 1.4 s again; (b) time a trivial SELECT 1 from the server; (c) check which region the Supabase project is in; and (d) load a few hundred medications to see whether the list route slows with data size.
4. **One alert I would want in production**
   errorRatePercent above 2% for 5 minutes (5xx only). It is 0 today, so any jump means something real is failing. A second alert: a route's avgMs above 500 ms. While a person is paged and fixes the cause, the app should keep working for users, as in Week 11: show a clear "try again shortly" message, or serve saved data where possible, instead of a blank screen or an error page.
