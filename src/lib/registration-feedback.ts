// Public, fixed messages only. Never render arbitrary server/library error text:
// it may contain account identifiers, infrastructure details or exception data.
export function registrationFailureMessage(status: number, body: unknown): string {
  const code = body && typeof body === "object" && "code" in body ? body.code : undefined;
  if (status === 503 && code === "REGISTRATION_PLATFORM_UNSUPPORTED") return "Регистрация недоступна в текущей среде запуска сервера. Обратитесь к организатору.";
  if (status === 503 && code === "VERIFICATION_DELIVERY_FAILED") return "Регистрация сохранена, но письмо с кодом не отправлено. Откройте «Подтвердить email» и запросите код повторно. Если письмо не приходит, обратитесь к организатору.";
  if (status === 503 && code === "NSUHW_PREPARATION_UNAVAILABLE") return "Сейчас не удаётся подготовить данные nsuhw. Регистрация не завершена. Обратитесь к организатору.";
  if (status >= 500) return "Сервис регистрации временно недоступен. Повторите позже или обратитесь к организатору.";
  if (status === 429) return "Слишком много попыток регистрации. Подождите минуту и повторите.";
  if (status === 403) return "Регистрация с этого адреса сайта или в текущем режиме недоступна. Обратитесь к организатору.";
  if (status === 413) return "Данные формы превышают допустимый размер. Проверьте длину введённого текста.";
  if (status === 400) return "Проверьте поля регистрации: ФИО, email, вуз и курс, пароль от 12 до 128 символов, латинское имя и фамилию либо подтверждённую заявку на старый логин.";
  return "Не удалось завершить регистрацию. Если у вас уже есть аккаунт, войдите или восстановите пароль.";
}
