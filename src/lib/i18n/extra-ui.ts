// Strings added by the audit fixes (docs/AUDIT-2026-10-17.md), ui track. Spread into uz.ts / ru.ts.
// Plain data with no imports: the client error boundaries import it directly (not the whole dictionary).
export const uiUz = {
  "leads.showMore": "Yana {n} tasini ko'rsatish",
  "fallback.errorTitle": "Sahifa ochilmadi",
  "fallback.errorBody": "Kutilmagan xatolik yuz berdi. Qayta urinib ko'ring — takrorlansa, administratorga xabar bering.",
  "fallback.retry": "Qayta urinish",
  "fallback.home": "Bosh sahifa",
  "fallback.code": "Xato kodi",
  "fallback.notFoundTitle": "Sahifa topilmadi",
  "fallback.notFoundBody": "Havola eskirgan yoki manzil noto'g'ri yozilgan.",
  "fallback.loading": "Yuklanmoqda…",
} as const;

export const uiRu: Record<keyof typeof uiUz, string> = {
  "leads.showMore": "Показать ещё {n}",
  "fallback.errorTitle": "Страница не открылась",
  "fallback.errorBody": "Произошла непредвиденная ошибка. Попробуйте ещё раз — если повторится, сообщите администратору.",
  "fallback.retry": "Повторить",
  "fallback.home": "На главную",
  "fallback.code": "Код ошибки",
  "fallback.notFoundTitle": "Страница не найдена",
  "fallback.notFoundBody": "Ссылка устарела или адрес набран с ошибкой.",
  "fallback.loading": "Загрузка…",
};
