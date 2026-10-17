// Strings added by the audit fixes (docs/AUDIT-2026-10-17.md), security track. Spread into uz.ts / ru.ts.
export const securityUz = {
  "settings.paymeKeyTaken": "Bu Payme kaliti boshqa markazga ulangan. Kassangizning o'z kalitini kiriting.",
  "settings.paymeFiscal": "Fiskal chek (ixtiyoriy)",
  "settings.paymeFiscalHint": "To'ldirilsa, Payme har bir to'lov uchun fiskal chek chiqaradi. Uchala maydonni ham kiriting yoki hammasini bo'sh qoldiring.",
  "settings.paymeIkpu": "MXIK (IKPU) kodi",
  "settings.paymePackageCode": "Qadoq kodi",
  "settings.paymeVat": "QQS, %",
  "settings.paymeFiscalInvalid": "Fiskal ma'lumot noto'g'ri: MXIK — 17 ta raqam, qadoq kodi majburiy, QQS 0–100.",
} as const;

export const securityRu: Record<keyof typeof securityUz, string> = {
  "settings.paymeKeyTaken": "Этот ключ Payme уже подключён к другому центру. Введите ключ своей кассы.",
  "settings.paymeFiscal": "Фискальный чек (необязательно)",
  "settings.paymeFiscalHint": "Если заполнено, Payme печатает фискальный чек на каждый платёж. Заполните все три поля или оставьте все пустыми.",
  "settings.paymeIkpu": "Код ИКПУ (MXIK)",
  "settings.paymePackageCode": "Код упаковки",
  "settings.paymeVat": "НДС, %",
  "settings.paymeFiscalInvalid": "Неверные фискальные данные: ИКПУ — 17 цифр, код упаковки обязателен, НДС 0–100.",
};
