BOT_NAME = "price_hawk"

SPIDER_MODULES = ["price_hawk.spiders"]
NEWSPIDER_MODULE = "price_hawk.spiders"

ROBOTSTXT_OBEY = True

CONCURRENT_REQUESTS = 8
CONCURRENT_REQUESTS_PER_DOMAIN = 4
DOWNLOAD_DELAY = 0.3
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 0.3
AUTOTHROTTLE_MAX_DELAY = 3.0

DEFAULT_REQUEST_HEADERS = {
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
}

ITEM_PIPELINES = {
    "price_hawk.pipelines.NormalizePhonePipeline": 300,
    "price_hawk.pipelines.BatchDBPipeline": 400,
}

# Disabled timestamped FEEDS export to prevent unbounded disk/inode exhaustion in production
FEEDS = {}
FEED_EXPORT_ENCODING = "utf-8"

REQUEST_FINGERPRINTER_IMPLEMENTATION = "2.7"
TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"

LOG_LEVEL = "WARNING"
