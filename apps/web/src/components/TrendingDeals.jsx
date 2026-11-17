"use client";

import React, { useEffect, useState } from "react";
import { getProducts } from "@/lib/apiClient";
import SearchCard from "./SearchCard";

export default function TrendingDeals({ initialProducts = null }) {
  const hasInitial = Array.isArray(initialProducts) && initialProducts.length > 0;
  const [products, setProducts] = useState(hasInitial ? initialProducts : []);
  const [loading, setLoading] = useState(!hasInitial);

  useEffect(() => {
    if (hasInitial) return;
    const controller = new AbortController();

    async function fetchTrending() {
      try {
        const response = await getProducts(1, 4, controller.signal);
        if (response.data && response.data.data) {
          setProducts(response.data.data);
        }
      } catch (error) {
        if (error?.name !== "CanceledError") {
          console.error("Failed to fetch trending deals", error);
        }
      } finally {
        setLoading(false);
      }
    }

    fetchTrending();
    return () => controller.abort();
  }, [hasInitial]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-80 bg-zinc-100 dark:bg-zinc-900 rounded-[24px] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!products.length) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {products.map((product) => (
        <div key={product.id} className="h-full">
          <SearchCard
            id={product.id}
            imageUrl={product.image_url}
            name={product.name}
            brand={product.brand}
            currentPrice={product.current_price || product.min_price || product.price}
          />
        </div>
      ))}
    </div>
  );
}
