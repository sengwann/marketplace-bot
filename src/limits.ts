// Text limits for seller input.
//
// IMPORTANT: Telegram allows at most 1024 characters in a photo caption, and the
// channel post is a photo with a caption. Worst case below is
// 100 + 200 + 250 + 60 = 610 characters of seller text, plus ~200 characters of
// labels/hashtags, so a post can never be rejected for being too long.
// If you raise these numbers, re-check that sum stays under 1024.
export const LIMITS = {
  productName: 100,
  condition: 200,
  note: 250,
  contact: 60,
  maxPhotos: 6,
  maxPrice: 99_999_999_999,
} as const;
