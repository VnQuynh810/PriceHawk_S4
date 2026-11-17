/**
 * Static OpenAPI 3.0.3 Specification for PriceHawk S4.
 * Works reliably inside Next.js `output: "standalone"` Docker containers
 * without requiring runtime source-folder AST scanning.
 */
export const getApiDocs = async () => ({
  openapi: "3.0.3",
  info: {
    title: "PriceHawk S4 API Documentation",
    version: "2.0.0",
    description:
      "RESTful API cho hệ thống so sánh giá thời gian thực PriceHawk S4 (App Router Clean Architecture).",
  },
  paths: {
    "/api/health": {
      get: {
        summary: "Health & Database readiness check",
        responses: { 200: { description: "Healthy" } },
      },
    },
    "/api/product": {
      get: {
        summary: "Lấy danh sách sản phẩm phân trang hoặc chi tiết theo ID",
        parameters: [
          { in: "query", name: "id", schema: { type: "integer" } },
          { in: "query", name: "page", schema: { type: "integer", default: 1 } },
          { in: "query", name: "pageSize", schema: { type: "integer", default: 12, maximum: 50 } },
        ],
        responses: { 200: { description: "Success" } },
      },
    },
    "/api/pagination": {
      get: {
        summary: "Tìm kiếm sản phẩm (FULLTEXT + relevance ranking)",
        parameters: [
          { in: "query", name: "q", required: true, schema: { type: "string" } },
          { in: "query", name: "page", schema: { type: "integer", default: 1 } },
          { in: "query", name: "pageSize", schema: { type: "integer", default: 12, maximum: 50 } },
        ],
        responses: { 200: { description: "Success" }, 400: { description: "Missing search term" } },
      },
    },
    "/api/compare": {
      get: {
        summary: "So sánh giá sản phẩm giữa các nhà bán lẻ",
        parameters: [{ in: "query", name: "id", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "Success" }, 400: { description: "Invalid product ID" } },
      },
    },
    "/api/price-history": {
      get: {
        summary: "Lịch sử biến động giá theo ngày/tuần (7d, 30d, 90d, 180d)",
        parameters: [
          { in: "query", name: "id", required: true, schema: { type: "integer" } },
          {
            in: "query",
            name: "range",
            schema: { type: "string", enum: ["7d", "30d", "90d", "180d"], default: "7d" },
          },
        ],
        responses: { 200: { description: "Success" } },
      },
    },
    "/api/me/summary": {
      get: {
        summary: "Tóm tắt số lượng Wishlist & Cảnh báo chạm ngưỡng cho Navbar",
        responses: { 200: { description: "Success" } },
      },
    },
    "/api/wishlist": {
      get: { summary: "Danh sách sản phẩm đã lưu của người dùng hiện tại", responses: { 200: { description: "Success" } } },
      post: { summary: "Thêm sản phẩm vào danh sách lưu", responses: { 201: { description: "Added" }, 401: { description: "Unauthorized" } } },
      delete: { summary: "Xóa sản phẩm khỏi danh sách lưu", responses: { 200: { description: "Removed" }, 401: { description: "Unauthorized" } } },
    },
    "/api/price-alert": {
      get: { summary: "Danh sách cảnh báo giá hoặc kiểm tra trạng thái chạm ngưỡng", responses: { 200: { description: "Success" } } },
      post: { summary: "Tạo cảnh báo giá mục tiêu mới", responses: { 201: { description: "Created" }, 401: { description: "Unauthorized" } } },
      put: { summary: "Cập nhật trạng thái cảnh báo (chỉ chủ sở hữu)", responses: { 200: { description: "Updated" }, 404: { description: "Not Found" } } },
      delete: { summary: "Xóa cảnh báo giá (chỉ chủ sở hữu)", responses: { 200: { description: "Deleted" }, 404: { description: "Not Found" } } },
    },
    "/api/extension/compare": {
      post: { summary: "So sánh sản phẩm từ Chrome Extension", responses: { 200: { description: "Matched or not found" } } },
    },
    "/api/extension/save": {
      post: {
        summary: "Lưu sản phẩm từ Chrome Extension (yêu cầu Session hoặc X-Extension-Key + domain uy tín)",
        responses: { 200: { description: "Saved" }, 401: { description: "Unauthorized" } },
      },
    },
  },
});
