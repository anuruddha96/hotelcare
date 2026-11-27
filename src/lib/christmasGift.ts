// One-off Christmas 2026 campaign, in the same Budapest timezone as winterSeason.
export const CHRISTMAS_DAY = "2026-12-25";
export const REHEARSAL_START = "2026-11-27";
export const REHEARSAL_NICKNAME = "anu_000";

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
});

export function christmasGiftDay(now = new Date()): string {
  const parts = dayFormat.formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return [part("year"), part("month"), part("day")].join("-");
}

export function christmasGiftEligibility(nickname: string | null | undefined, now = new Date()): string | null {
  const day = christmasGiftDay(now);
  if (day === CHRISTMAS_DAY) return day;
  if (day >= REHEARSAL_START && day < CHRISTMAS_DAY &&
      nickname?.trim().toLowerCase() === REHEARSAL_NICKNAME) return day;
  return null;
}

export function christmasGiftStorageKey(userId: string, day: string) {
  return `hotelcare-christmas-gift:2026:${userId}:${day}`;
}

type GiftCopy = { title: string; intro: string; open: string; greeting: string; note: string; close: string; skip: string; from: string };

export const christmasGiftCopy: Record<string, GiftCopy> = {
  en: {
    title: "A little Christmas magic", intro: "Santa has a special gift just for you!", open: "Open my gift",
    greeting: "Merry Christmas!", note: "The greatest gift is the kindness we share. Thank you for the care, effort and warmth you bring to every day. Whether you are working today or celebrating with loved ones, may this Christmas bring you peace, joy and a little magic of your own.",
    close: "Thank you!", skip: "Continue to HotelCare", from: "With warm wishes, the HotelCare team",
  },
  hu: {
    title: "Egy kis karácsonyi varázslat", intro: "A Mikulás különleges ajándékot hozott neked!", open: "Kibontom az ajándékom",
    greeting: "Boldog karácsonyt!", note: "A legnagyobb ajándék a szeretet és kedvesség, amit egymásnak adunk. Köszönjük a gondoskodást, a munkádat és a melegséget, amit minden nap magaddal hozol. Akár ma is dolgozol, akár a szeretteiddel ünnepelsz, kívánunk neked békét, örömet és egy kis karácsonyi varázslatot.",
    close: "Köszönöm!", skip: "Tovább a HotelCare-be", from: "Szeretettel, a HotelCare csapata",
  },
  es: {
    title: "Un poquito de magia navideña", intro: "¡Papá Noel tiene un regalo especial para ti!", open: "Abrir mi regalo",
    greeting: "¡Feliz Navidad!", note: "El mejor regalo es la bondad que compartimos. Gracias por el cariño, el esfuerzo y la calidez que aportas cada día. Tanto si trabajas hoy como si celebras con tus seres queridos, que esta Navidad te traiga paz, alegría y un poquito de magia.",
    close: "¡Gracias!", skip: "Continuar a HotelCare", from: "Con cariño, el equipo de HotelCare",
  },
  vi: {
    title: "Một chút phép màu Giáng sinh", intro: "Ông già Noel có một món quà đặc biệt dành cho bạn!", open: "Mở quà của tôi",
    greeting: "Giáng sinh vui vẻ!", note: "Món quà quý giá nhất là lòng tốt chúng ta dành cho nhau. Cảm ơn bạn vì sự tận tâm, nỗ lực và ấm áp mỗi ngày. Dù hôm nay bạn đang làm việc hay đón lễ cùng người thân, chúc bạn một mùa Giáng sinh bình an, vui vẻ và đầy phép màu.",
    close: "Cảm ơn!", skip: "Tiếp tục đến HotelCare", from: "Thân ái, đội ngũ HotelCare",
  },
  mn: {
    title: "Зул сарын бяцхан ид шид", intro: "Өвлийн өвгөн танд зориулсан онцгой бэлэгтэй!", open: "Бэлгээ нээх",
    greeting: "Зул сарын мэнд хүргэе!", note: "Хамгийн үнэтэй бэлэг бол бидний бие биедээ түгээдэг сайхан сэтгэл юм. Өдөр бүр гаргадаг хичээл зүтгэл, халамж, дулаан сэтгэлд тань баярлалаа. Та өнөөдөр ажиллаж байгаа ч, хайртай хүмүүстэйгээ баярлаж байгаа ч амар амгалан, баяр баясгалан, бяцхан ид шидээр дүүрэн байх болтугай.",
    close: "Баярлалаа!", skip: "HotelCare руу үргэлжлүүлэх", from: "Халуун мэндчилгээ дэвшүүлсэн HotelCare баг",
  },
  az: {
    title: "Bir az Milad möcüzəsi", intro: "Şaxta babanın sizin üçün xüsusi hədiyyəsi var!", open: "Hədiyyəmi aç",
    greeting: "Milad bayramınız mübarək!", note: "Ən böyük hədiyyə bir-birimizə göstərdiyimiz mehribanlıqdır. Hər gün göstərdiyiniz qayğıya, zəhmətə və səmimiyyətə görə təşəkkür edirik. Bu gün istər işləyin, istərsə də yaxınlarınızla bayram edin, sizə sülh, sevinc və bir az möcüzə arzulayırıq.",
    close: "Təşəkkür edirəm!", skip: "HotelCare-ə davam et", from: "Ən xoş arzularla, HotelCare komandası",
  },
  tl: {
    title: "Kaunting mahika ng Pasko", intro: "May espesyal na regalo si Santa para sa iyo!", open: "Buksan ang regalo ko",
    greeting: "Maligayang Pasko!", note: "Ang pinakamagandang regalo ay ang kabutihang ibinabahagi natin sa isa't isa. Salamat sa malasakit, pagsisikap at init na hatid mo araw-araw. Nagtatrabaho ka man ngayon o nagdiriwang kasama ang mga mahal mo sa buhay, sana ay magdala ang Pasko ng kapayapaan, saya at kaunting mahika sa iyo.",
    close: "Salamat!", skip: "Magpatuloy sa HotelCare", from: "Taos-pusong pagbati, ang HotelCare team",
  },
  uk: {
    title: "Трішки різдвяного дива", intro: "Санта має особливий подарунок для вас!", open: "Відкрити мій подарунок",
    greeting: "Веселого Різдва!", note: "Найкращий подарунок — це доброта, якою ми ділимося. Дякуємо за турботу, зусилля й тепло, які ви даруєте щодня. Незалежно від того, працюєте ви сьогодні чи святкуєте з близькими, нехай Різдво принесе вам мир, радість і трішки дива.",
    close: "Дякую!", skip: "Перейти до HotelCare", from: "З теплими побажаннями, команда HotelCare",
  },
  ru: {
    title: "Немного рождественского волшебства", intro: "У Санты есть особенный подарок для вас!", open: "Открыть мой подарок",
    greeting: "Счастливого Рождества!", note: "Самый ценный подарок — доброта, которой мы делимся. Спасибо за заботу, труд и тепло, которые вы дарите каждый день. Работаете ли вы сегодня или празднуете с близкими, пусть Рождество принесёт вам мир, радость и немного волшебства.",
    close: "Спасибо!", skip: "Перейти в HotelCare", from: "С тёплыми пожеланиями, команда HotelCare",
  },
};

export function getChristmasGiftCopy(language: string | null | undefined): GiftCopy {
  const key = language?.toLowerCase().split(/[-_]/)[0] ?? "en";
  return Object.prototype.hasOwnProperty.call(christmasGiftCopy, key) ? christmasGiftCopy[key] : christmasGiftCopy.en;
}
