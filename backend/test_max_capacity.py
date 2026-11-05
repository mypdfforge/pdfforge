import asyncio
import time
import httpx

BASE_API = "http://127.0.0.1:8000"

async def test_ramp():
    print("Pushing max concurrency to determine server breaking point...")
    concurrencies = [50, 100, 200, 300, 400, 500]
    results = []

    for c in concurrencies:
        limits = httpx.Limits(max_keepalive_connections=c, max_connections=c * 2)
        timeout = httpx.Timeout(10.0, connect=3.0)
        t0 = time.perf_counter()
        errors = 0
        success = 0
        rate_limits = 0

        async with httpx.AsyncClient(limits=limits, timeout=timeout) as client:
            async def hit(idx):
                nonlocal errors, success, rate_limits
                try:
                    r = await client.get(
                        f"{BASE_API}/api/health",
                        headers={"X-Forwarded-For": f"172.16.{idx // 256}.{idx % 256 + 1}"}
                    )
                    if r.status_code == 200:
                        success += 1
                    elif r.status_code == 429:
                        rate_limits += 1
                    else:
                        errors += 1
                except Exception:
                    errors += 1

            tasks = [hit(i) for i in range(c)]
            await asyncio.gather(*tasks)

        elapsed = time.perf_counter() - t0
        rps = c / elapsed if elapsed > 0 else 0
        print(f"Concurrency {c:3d}: Elapsed={elapsed:.3f}s | RPS={rps:6.1f} | 200 OK={success} | 429 RL={rate_limits} | Errors/Timeouts={errors}")
        results.append({"c": c, "elapsed": elapsed, "rps": rps, "ok": success, "rl": rate_limits, "err": errors})
        await asyncio.sleep(0.5)

if __name__ == "__main__":
    asyncio.run(test_ramp())
