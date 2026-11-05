import asyncio
import time
import json
import statistics
from pathlib import Path
import httpx

BASE_API = "http://127.0.0.1:8000"
FRONTEND_URL = "http://localhost:5173"
SAMPLE_PDF = Path("../frontend/fixtures/bill-sample.pdf")

async def worker_get(client, url, headers=None):
    t0 = time.perf_counter()
    try:
        resp = await client.get(url, headers=headers)
        duration = (time.perf_counter() - t0) * 1000
        return resp.status_code, duration, None
    except Exception as e:
        duration = (time.perf_counter() - t0) * 1000
        return 0, duration, str(e)

async def worker_post_upload(client, url, pdf_bytes, filename="test.pdf", headers=None):
    t0 = time.perf_counter()
    try:
        files = {"file": (filename, pdf_bytes, "application/pdf")}
        resp = await client.post(url, files=files, headers=headers)
        duration = (time.perf_counter() - t0) * 1000
        return resp.status_code, duration, None
    except Exception as e:
        duration = (time.perf_counter() - t0) * 1000
        return 0, duration, str(e)

def compute_stats(latencies, statuses, total_wall_time):
    if not latencies:
        return {}
    sorted_lat = sorted(latencies)
    n = len(sorted_lat)
    p50 = sorted_lat[int(n * 0.50)]
    p90 = sorted_lat[int(n * 0.90)]
    p95 = sorted_lat[int(n * 0.95)]
    p99 = sorted_lat[int(n * 0.99)] if n >= 100 else sorted_lat[-1]
    
    status_counts = {}
    for s in statuses:
        status_counts[s] = status_counts.get(s, 0) + 1
        
    rps = len(latencies) / total_wall_time if total_wall_time > 0 else 0
    return {
        "total_requests": n,
        "wall_time_sec": round(total_wall_time, 3),
        "rps": round(rps, 1),
        "mean_ms": round(statistics.mean(latencies), 2),
        "min_ms": round(sorted_lat[0], 2),
        "p50_ms": round(p50, 2),
        "p90_ms": round(p90, 2),
        "p95_ms": round(p95, 2),
        "p99_ms": round(p99, 2),
        "max_ms": round(sorted_lat[-1], 2),
        "status_distribution": status_counts
    }

async def benchmark_concurrency_get(url, concurrency, requests_per_worker, distribute_ips=False):
    limits = httpx.Limits(max_keepalive_connections=concurrency, max_connections=concurrency * 2)
    timeout = httpx.Timeout(15.0, connect=5.0)
    
    tasks = []
    t_start = time.perf_counter()
    
    async with httpx.AsyncClient(limits=limits, timeout=timeout) as client:
        async def single_user_loop(user_idx):
            results = []
            headers = {"X-Forwarded-For": f"192.168.1.{100 + user_idx}"} if distribute_ips else {}
            for _ in range(requests_per_worker):
                res = await worker_get(client, url, headers=headers)
                results.append(res)
            return results

        user_coros = [single_user_loop(i) for i in range(concurrency)]
        all_results_nested = await asyncio.gather(*user_coros)

    t_total = time.perf_counter() - t_start
    all_results = [item for sub in all_results_nested for item in sub]
    statuses = [r[0] for r in all_results]
    latencies = [r[1] for r in all_results]
    
    return compute_stats(latencies, statuses, t_total)

async def benchmark_pdf_upload(concurrency, requests_per_worker):
    if not SAMPLE_PDF.exists():
        # Fallback create a dummy pdf if fixture missing
        pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Count 1\n/Kids [3 0 R]\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n>>\nendobj\nxref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000060 00000 n\n0000000117 00000 n\ntrailer\n<<\n/Size 4\n/Root 1 0 R\n>>\nstartxref\n190\n%%EOF"
    else:
        pdf_bytes = SAMPLE_PDF.read_bytes()

    limits = httpx.Limits(max_keepalive_connections=concurrency, max_connections=concurrency * 2)
    timeout = httpx.Timeout(30.0, connect=5.0)
    
    t_start = time.perf_counter()
    async with httpx.AsyncClient(limits=limits, timeout=timeout) as client:
        async def single_user_upload(user_idx):
            results = []
            headers = {"X-Forwarded-For": f"10.0.{user_idx // 256}.{user_idx % 256 + 1}"}
            for _ in range(requests_per_worker):
                res = await worker_post_upload(client, f"{BASE_API}/api/upload", pdf_bytes, filename=f"user_{user_idx}.pdf", headers=headers)
                results.append(res)
            return results

        coros = [single_user_upload(i) for i in range(concurrency)]
        all_results_nested = await asyncio.gather(*coros)

    t_total = time.perf_counter() - t_start
    all_results = [item for sub in all_results_nested for item in sub]
    statuses = [r[0] for r in all_results]
    latencies = [r[1] for r in all_results]
    
    return compute_stats(latencies, statuses, t_total)

async def test_event_loop_blocking():
    """
    Test if heavy PDF uploads block lightweight health check requests.
    """
    pdf_bytes = SAMPLE_PDF.read_bytes() if SAMPLE_PDF.exists() else b"%PDF-1.4..."
    limits = httpx.Limits(max_keepalive_connections=50, max_connections=100)
    timeout = httpx.Timeout(20.0)
    
    async with httpx.AsyncClient(limits=limits, timeout=timeout) as client:
        # Launch 10 heavy uploads in parallel
        upload_tasks = [
            worker_post_upload(client, f"{BASE_API}/api/upload", pdf_bytes, headers={"X-Forwarded-For": f"10.1.1.{i+1}"})
            for i in range(10)
        ]
        
        # Concurrently ping health check multiple times
        async def ping_health_while_busy():
            await asyncio.sleep(0.01) # start right as uploads start
            pings = []
            for _ in range(20):
                pings.append(await worker_get(client, f"{BASE_API}/api/health"))
                await asyncio.sleep(0.02)
            return pings

        pings_res, uploads_res = await asyncio.gather(ping_health_while_busy(), asyncio.gather(*upload_tasks))
        
        ping_latencies = [p[1] for p in pings_res]
        upload_latencies = [u[1] for u in uploads_res]
        
        return {
            "health_pings_during_load": {
                "count": len(ping_latencies),
                "mean_ms": round(statistics.mean(ping_latencies), 2),
                "max_ms": round(max(ping_latencies), 2),
                "statuses": [p[0] for p in pings_res]
            },
            "uploads_under_load": {
                "count": len(upload_latencies),
                "mean_ms": round(statistics.mean(upload_latencies), 2),
                "max_ms": round(max(upload_latencies), 2),
                "statuses": [u[0] for u in uploads_res]
            }
        }

async def run_full_suite():
    results = {}
    print("=== 1. BASELINE CONCURRENCY TEST (/api/health) ===")
    results["health_concurrency"] = {}
    for c in [1, 10, 50, 100, 200]:
        reqs = max(1, 400 // c)
        print(f"Testing Concurrency={c} (Total requests: {c * reqs})...")
        stat = await benchmark_concurrency_get(f"{BASE_API}/api/health", c, reqs, distribute_ips=True)
        results["health_concurrency"][f"c_{c}"] = stat
        print(f"  -> RPS: {stat['rps']}, p50: {stat['p50_ms']}ms, p95: {stat['p95_ms']}ms, Statuses: {stat['status_distribution']}")

    print("\n=== 2. RATE LIMITER STRESS TEST (Single IP vs Distributed IPs) ===")
    print("Testing 100 rapid requests from a SINGLE IP:")
    stat_single = await benchmark_concurrency_get(f"{BASE_API}/api/health", concurrency=5, requests_per_worker=20, distribute_ips=False)
    print(f"  -> Single IP Statuses: {stat_single['status_distribution']}")
    results["rate_limit_single_ip"] = stat_single

    print("Testing 100 rapid requests from 100 DISTRIBUTED IPs:")
    stat_multi = await benchmark_concurrency_get(f"{BASE_API}/api/health", concurrency=20, requests_per_worker=5, distribute_ips=True)
    print(f"  -> Distributed IPs Statuses: {stat_multi['status_distribution']}")
    results["rate_limit_distributed_ips"] = stat_multi

    print("\n=== 3. FRONTEND STATIC ASSET CONCURRENCY (http://localhost:5173/) ===")
    results["frontend_concurrency"] = {}
    for c in [5, 25, 50]:
        reqs = 10
        print(f"Testing Frontend Server Concurrency={c}...")
        stat = await benchmark_concurrency_get(f"{FRONTEND_URL}/", c, reqs)
        results["frontend_concurrency"][f"c_{c}"] = stat
        print(f"  -> RPS: {stat['rps']}, p50: {stat['p50_ms']}ms, p95: {stat['p95_ms']}ms, Statuses: {stat['status_distribution']}")

    print("\n=== 4. HEAVY PDF UPLOAD STRESS TEST (/api/upload with real PDF) ===")
    results["upload_concurrency"] = {}
    for c in [1, 5, 10, 20]:
        reqs = 3
        print(f"Testing Upload Concurrency={c} users...")
        stat = await benchmark_pdf_upload(c, reqs)
        results["upload_concurrency"][f"c_{c}"] = stat
        print(f"  -> RPS: {stat['rps']}, Mean: {stat['mean_ms']}ms, p95: {stat['p95_ms']}ms, Statuses: {stat['status_distribution']}")

    print("\n=== 5. EVENT LOOP BLOCKING / STARVATION TEST ===")
    stat_starve = await test_event_loop_blocking()
    results["event_loop_blocking"] = stat_starve
    print(f"  -> Health pings during heavy uploads: mean={stat_starve['health_pings_during_load']['mean_ms']}ms, max={stat_starve['health_pings_during_load']['max_ms']}ms")
    print(f"  -> Uploads latency: mean={stat_starve['uploads_under_load']['mean_ms']}ms, max={stat_starve['uploads_under_load']['max_ms']}ms")

    with open("stress_test_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nAll stress tests finished! Results saved to backend/stress_test_results.json")

if __name__ == "__main__":
    asyncio.run(run_full_suite())
