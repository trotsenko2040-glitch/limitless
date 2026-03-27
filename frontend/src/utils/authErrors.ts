export function resolveAuthError(error?: string): string {
  switch (error) {
    case 'KEY_NOT_FOUND':
      return 'Этот ключ не найден. Проверьте его и попробуйте снова.';
    case 'KEY_ALREADY_USED':
      return 'Этот ключ уже был активирован. Используйте токен, который был выдан после активации.';
    case 'TOKEN_NOT_FOUND':
      return 'Этот токен не найден. Получите актуальный код в Telegram-боте.';
    case 'DEVICE_ALREADY_BOUND':
      return 'На этом устройстве уже активирован другой токен. Смена аккаунта отключена.';
    case 'TOKEN_ALREADY_BOUND':
      return 'Этот токен уже активирован на другом устройстве.';
    case 'DEVICE_ID_REQUIRED':
      return 'Не удалось определить это устройство для активации.';
    case 'INVALID_TOKEN_FORMAT':
      return 'Неверный формат токена или ключа. Используйте код из Telegram-бота.';
    case 'SUBSCRIPTION_EXPIRED':
      return 'Срок действия доступа закончился. Продлите подписку, чтобы снова войти.';
    case 'SUBSCRIPTION_INACTIVE':
      return 'Подписка по этому коду сейчас не активна.';
    case 'TOKEN_REVOKED':
      return 'Этот токен был отозван и больше не действует.';
    case 'VALIDATION_UNAVAILABLE':
      return 'Сервер проверки временно недоступен. Попробуйте чуть позже.';
    default:
      return 'Недействительный токен или ключ. Получите новый код в Telegram-боте.';
  }
}
