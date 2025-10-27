import { Product } from '@/types/database';

export type SerializedProduct = Omit<Product, 'options_json'> & {
  options?: Product['options'];
};

export const serializeProduct = (product: Product): SerializedProduct => {
  let options = product.options;

  if (!options && product.options_json) {
    try {
      const parsed = JSON.parse(product.options_json);
      if (Array.isArray(parsed)) {
        options = parsed;
      }
    } catch (error) {
      console.warn('Failed to parse product options in serializeProduct', error);
    }
  }

  const { options_json: unusedOptionsJson, ...rest } = product;
  void unusedOptionsJson;

  return {
    ...rest,
    options,
  };
};
