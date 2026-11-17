import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 25 },
    { duration: "1m", target: 60 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const listRes = http.get("http://web:3000/api/product?page=1&pageSize=12");
  check(listRes, { "product list 200": (r) => r.status === 200 });

  const searchRes = http.get("http://web:3000/api/pagination?q=iphone&page=1&pageSize=8");
  check(searchRes, { "search 200": (r) => r.status === 200 });

  const healthRes = http.get("http://chatbot:8000/health");
  check(healthRes, { "chatbot health 200": (r) => r.status === 200 });

  sleep(1);
}
