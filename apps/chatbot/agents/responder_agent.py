"""
responder_agent.py — Non-blocking AsyncGroq Response Generator.
"""

import asyncio
import os
from dotenv import load_dotenv
from groq import AsyncGroq

load_dotenv()

groq_api_key = os.getenv("GROQ_API_KEY")
client = AsyncGroq(api_key=groq_api_key) if groq_api_key else None
MODEL_PRIMARY = "llama-3.3-70b-versatile"
MODEL_FALLBACK = "llama-3.1-8b-instant"

RETAILER_DISPLAY = {
    "tgdd": "Thế Giới Di Động",
    "fpt": "FPT Shop",
    "hoangha": "Hoàng Hà Mobile",
    "cellphones": "CellphoneS",
}

IRRELEVANT_REPLY = (
    "Xin chào! Mình là trợ lý so sánh giá của **PriceHawk** 🦅\n\n"
    "Mình chỉ có thể giúp bạn với:\n"
    "- 📱 **Tìm giá điện thoại** từ nhiều cửa hàng\n"
    "- 💻 **So sánh giá laptop** giữa TGDD, FPT Shop, Hoàng Hà Mobile\n"
    "- 📊 **Thông số kỹ thuật** và đánh giá sản phẩm\n\n"
    "Bạn muốn tìm sản phẩm nào?"
)

OUT_OF_SCOPE_REPLY = (
    "Câu hỏi này nằm ngoài phạm vi mình có thể hỗ trợ 😅\n\n"
    "**PriceHawk** chuyên về:\n"
    "- 💰 So sánh **giá** điện thoại, laptop, tablet\n"
    "- 📊 **Thông số kỹ thuật** và đánh giá sản phẩm\n\n"
    "Bạn muốn tìm giá hoặc so sánh sản phẩm nào không?"
)


def _format_price(price) -> str:
    try:
        price_int = int(round(float(price)))
        return f"{price_int:,}đ".replace(",", ".")
    except (ValueError, TypeError):
        return str(price) if price else "Liên hệ"


def _format_product_data(products: list[dict]) -> str:
    if not products:
        return "Không có dữ liệu."
    lines = []
    for i, product in enumerate(products[:3], 1):
        lines.append(f"\n[Sản phẩm {i}] {product['name']}")
        if product.get("brand"):
            lines.append(f"  Thương hiệu: {product['brand']}")
        if product.get("prices"):
            lines.append("  Giá theo cửa hàng:")
            for price_info in product["prices"]:
                retailer_key = price_info.get("retailer", "")
                retailer_display = RETAILER_DISPLAY.get(retailer_key, retailer_key.upper())
                price_str = _format_price(price_info.get("price"))
                url = price_info.get("url", "")
                lines.append(f"    - {retailer_display}: {price_str} ({url})")
    return "\n".join(lines)


class ResponderAgent:
    async def reply_from_db(self, db_result: dict, user_message: str, intent: str) -> dict:
        products = db_result.get("products", [])
        product_data_text = _format_product_data(products)

        if intent == "compare":
            instruction = (
                "Hãy trình bày thông tin SO SÁNH chi tiết cho các sản phẩm tìm được dưới dạng DANH SÁCH (TUYỆT ĐỐI KHÔNG DÙNG BẢNG). "
                "Mỗi sản phẩm hãy in đậm tên, sau đó gạch đầu dòng các tiêu chí cơ bản (Giá, RAM, Camera, Pin, Chipset). "
                "MỨC GIÁ bắt buộc lấy từ dữ liệu hệ thống kèm link mua hàng định dạng chuẩn Markdown: [Tên cửa hàng](url). "
                "Sau khi liệt kê, thêm 2-3 dòng nhận xét ngắn gọn."
            )
        else:
            instruction = (
                "1. Tóm tắt sản phẩm tìm được\n"
                "2. Bảng giá từ các cửa hàng (rẻ đến đắt), BẮT BUỘC chèn kèm link mua hàng chuẩn Markdown: [Tên cửa hàng](url)\n"
                "3. Gợi ý cửa hàng rẻ nhất và chèn lại link của sản phẩm rẻ nhất đó.\n"
                "Nếu nhiều sản phẩm tương tự, hiển thị tối đa 3 cái phù hợp nhất."
            )

        partial_notice = ""
        if db_result.get("partial_fallback"):
            partial_notice = (
                f"\n\nLƯU Ý: Hệ thống KHÔNG tìm thấy chính xác '{db_result.get('search_keyword')}', "
                "chỉ tìm thấy các sản phẩm tương tự dưới đây. Hãy lịch sự thông báo trước khi đề xuất."
            )

        prompt = (
            f"Bạn là trợ lý so sánh giá của PriceHawk — website so sánh giá điện thoại, laptop, tablet tại Việt Nam.\n\n"
            f'Người dùng hỏi: "{user_message}"\n\n'
            f"Thông tin giá từ hệ thống:\n{product_data_text}{partial_notice}\n\n"
            f"Hãy viết câu trả lời tiếng Việt thân thiện, bao gồm:\n{instruction}"
        )

        reply_text = self._manual_format_db(products)
        models_to_try = [MODEL_PRIMARY, MODEL_FALLBACK] if client else []

        for attempt, model_name in enumerate(models_to_try):
            try:
                response = await client.chat.completions.create(
                    model=model_name,
                    temperature=0.3,
                    messages=[{"role": "user", "content": prompt}],
                )
                reply_text = (response.choices[0].message.content or "").strip() or reply_text
                break
            except Exception as e:
                if ("429" in str(e) or "RESOURCE_EXHAUSTED" in str(e)) and attempt < len(models_to_try) - 1:
                    await asyncio.sleep(1.5)
                    continue
                print(f"[ResponderAgent] LLM error ({model_name}): {e}")
                break

        return {
            "reply": reply_text,
            "source": "database",
            "products": products,
            "search_keyword": db_result.get("search_keyword"),
        }

    async def reply_from_internet(self, internet_result: dict, user_message: str) -> dict:
        if not internet_result.get("found"):
            return self.reply_not_found(user_message, internet_result.get("keyword", ""))

        source_url = internet_result.get("source_url", "")
        raw_context = internet_result.get("summary", "")

        prompt = (
            "Bạn là trợ lý so sánh giá của PriceHawk.\n\n"
            f'Người dùng hỏi: "{user_message}"\n\n'
            f"Thông tin thu thập từ web (nguồn chính: {source_url}):\n{raw_context}\n\n"
            "Hãy tổng hợp và trả lời ngắn gọn bằng tiếng Việt (tối đa 250 từ), tập trung vào mức giá tham khảo, "
            "thông số chính và ưu/nhược điểm. Cuối câu trả lời BẮT BUỘC chèn nguồn chuẩn Markdown: "
            f"[Nguồn tham khảo]({source_url})."
        )

        reply_text = (
            f"Tôi tìm được thông tin tham khảo về **{internet_result.get('keyword')}**:\n\n"
            f"{raw_context[:500]}...\n\n[Nguồn tham khảo]({source_url})"
        )
        models_to_try = [MODEL_PRIMARY, MODEL_FALLBACK] if client else []

        for attempt, model_name in enumerate(models_to_try):
            try:
                response = await client.chat.completions.create(
                    model=model_name,
                    temperature=0.3,
                    messages=[{"role": "user", "content": prompt}],
                )
                reply_text = (response.choices[0].message.content or "").strip() or reply_text
                break
            except Exception as e:
                if ("429" in str(e) or "RESOURCE_EXHAUSTED" in str(e)) and attempt < len(models_to_try) - 1:
                    await asyncio.sleep(1.5)
                    continue
                print(f"[ResponderAgent] LLM error ({model_name}): {e}")
                break

        return {
            "reply": reply_text,
            "source": "internet",
            "products": [],
            "source_url": source_url,
        }

    def reply_irrelevant(self) -> dict:
        return {"reply": IRRELEVANT_REPLY, "source": "system", "products": []}

    def reply_out_of_scope(self) -> dict:
        return {"reply": OUT_OF_SCOPE_REPLY, "source": "system", "products": []}

    def reply_not_found(self, user_message: str, keyword: str) -> dict:
        reply = (
            f"Xin lỗi, tôi không tìm thấy thông tin về **{keyword or user_message}** "
            "trong cơ sở dữ liệu của PriceHawk cũng như trên các trang web công nghệ.\n\n"
            "Bạn có thể thử:\n"
            "- Kiểm tra lại tên sản phẩm\n"
            "- Tìm kiếm trực tiếp tại [Thế Giới Di Động](https://thegioididong.com), "
            "[FPT Shop](https://fptshop.com.vn) hoặc [Hoàng Hà Mobile](https://hoanghamobile.com)"
        )
        return {"reply": reply, "source": "not_found", "products": []}

    def _manual_format_db(self, products: list[dict]) -> str:
        if not products:
            return "Không tìm thấy sản phẩm phù hợp."
        lines = ["Tôi tìm thấy các sản phẩm sau trong hệ thống:\n"]
        for product in products[:3]:
            lines.append(f"**{product['name']}**")
            for price_info in product.get("prices", []):
                retailer_key = price_info.get("retailer", "")
                retailer_display = RETAILER_DISPLAY.get(retailer_key, retailer_key)
                price_str = _format_price(price_info.get("price"))
                lines.append(f"- {retailer_display}: {price_str}")
            lines.append("")
        return "\n".join(lines)
