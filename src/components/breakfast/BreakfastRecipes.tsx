import { useState } from "react";
import { BookOpen, CheckCircle2, ChefHat, GlassWater, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type DrinkType = "milkshake" | "smoothie";
type MilkshakeFlavor = "strawberry" | "mango" | "chocolate" | "nutella";
type SmoothieStyle = "juice" | "yogurt" | "fruit";

const milkshakeFlavors: MilkshakeFlavor[] = ["strawberry", "mango", "chocolate", "nutella"];
const smoothieStyles: SmoothieStyle[] = ["juice", "yogurt", "fruit"];

// These are read-only staff instructions; no PMS or attendance data is changed.
const translations = {
  en: {
    heading: "Drink recipes",
    intro: "Quick preparation guide for the breakfast team",
    portions: "Makes 2 servings",
    milkshakes: "Milkshakes",
    smoothies: "Smoothies",
    chooseFlavor: "Choose a milkshake flavour",
    chooseStyle: "Choose a smoothie base",
    ingredients: "Ingredients",
    steps: "How to prepare",
    milkshake: "milkshake",
    milkshakeFlavors: {
      strawberry: "Strawberry",
      mango: "Mango",
      chocolate: "Chocolate",
      nutella: "Nutella",
    },
    milkshakeIngredients: {
      strawberry: "Strawberries (fresh or frozen), to taste",
      mango: "Mango pieces (fresh or frozen), to taste",
      chocolate: "Chocolate powder, to taste",
      nutella: "Nutella, to taste",
    },
    smoothieNames: {
      juice: "Fruit juice smoothie",
      yogurt: "Greek yogurt & milk smoothie",
      fruit: "Fruit-only smoothie",
    },
    smoothieHints: {
      juice: "Light & refreshing",
      yogurt: "Creamy",
      fruit: "No milk or juice",
    },
    milk: "250 mL milk",
    iceCream: "3 scoops of ice cream",
    sweetener: "A few drops of coffee sweetener",
    ice: "Ice cubes",
    juice: "Apple, peach or another fruit juice chosen by the guest (enough to blend)",
    fruits: "Fresh or frozen fruit of the guest's choice",
    greekYogurt: "3–4 tablespoons Greek yogurt",
    juicyFruit: "Ripe, juicy fruit of the guest's choice",
    littleSweetener: "A little coffee sweetener",
    milkshakeSteps: [
      "Pour approximately 250 mL milk into the blender.",
      "Add 3 scoops of ice cream, the selected flavour ingredient and a few drops of coffee sweetener.",
      "Add ice and blend thoroughly until creamy and smooth.",
      "Pour evenly into two glasses and serve immediately.",
    ],
    juiceSteps: [
      "Pour the guest's preferred fruit juice into the blender.",
      "Add fruit, a few drops of coffee sweetener and ice.",
      "Blend until smooth. Adjust the juice slightly if a thinner texture is preferred.",
      "Divide between two glasses and serve.",
    ],
    yogurtSteps: [
      "Pour 250 mL milk into the blender and add 3–4 tablespoons of Greek yogurt.",
      "Add the guest's preferred fruit and ice.",
      "Blend well until smooth and creamy.",
      "Divide between two glasses and serve.",
    ],
    fruitSteps: [
      "Add ripe, juicy fruits to the blender. Do not add milk or fruit juice.",
      "Add ice and a little coffee sweetener.",
      "Blend or pulse until smooth, using softer fruit as needed to help it blend.",
      "Divide between two glasses and serve.",
    ],
    note: "Ask about allergies and dietary needs before preparing. Milkshakes and yogurt smoothies contain dairy; Nutella contains hazelnuts.",
  },
  hu: {
    heading: "Italreceptek",
    intro: "Gyors elkészítési útmutató a reggeliztető csapatnak",
    portions: "2 adag",
    milkshakes: "Tejturmixok",
    smoothies: "Smoothie-k",
    chooseFlavor: "Válassz tejturmixízt",
    chooseStyle: "Válassz smoothie-alapot",
    ingredients: "Hozzávalók",
    steps: "Elkészítés",
    milkshake: "tejturmix",
    milkshakeFlavors: {
      strawberry: "Epres",
      mango: "Mangós",
      chocolate: "Csokoládés",
      nutella: "Nutellás",
    },
    milkshakeIngredients: {
      strawberry: "Eper (friss vagy fagyasztott), ízlés szerint",
      mango: "Mangódarabok (friss vagy fagyasztott), ízlés szerint",
      chocolate: "Csokoládépor, ízlés szerint",
      nutella: "Nutella, ízlés szerint",
    },
    smoothieNames: {
      juice: "Gyümölcsleves smoothie",
      yogurt: "Görög joghurtos-tejes smoothie",
      fruit: "Csak gyümölcsös smoothie",
    },
    smoothieHints: {
      juice: "Könnyű és frissítő",
      yogurt: "Krémes",
      fruit: "Tej és gyümölcslé nélkül",
    },
    milk: "250 ml tej",
    iceCream: "3 gombóc fagylalt",
    sweetener: "Néhány csepp kávéédesítő",
    ice: "Jégkockák",
    juice: "Alma-, őszibarack- vagy a vendég által választott gyümölcslé (a turmixoláshoz elegendő mennyiség)",
    fruits: "A vendég által választott friss vagy fagyasztott gyümölcs",
    greekYogurt: "3–4 evőkanál görög joghurt",
    juicyFruit: "A vendég által választott érett, lédús gyümölcs",
    littleSweetener: "Kevés kávéédesítő",
    milkshakeSteps: [
      "Önts kb. 250 ml tejet a turmixgépbe.",
      "Adj hozzá 3 gombóc fagylaltot, a kiválasztott ízesítőt és néhány csepp kávéédesítőt.",
      "Adj hozzá jeget, és turmixold alaposan krémesre.",
      "Oszd el két pohárba, és azonnal tálald.",
    ],
    juiceSteps: [
      "Öntsd a vendég által választott gyümölcslevet a turmixgépbe.",
      "Add hozzá a gyümölcsöt, néhány csepp kávéédesítőt és a jeget.",
      "Turmixold simára. Hígabb állaghoz adj hozzá egy kevés gyümölcslevet.",
      "Oszd el két pohárba, és tálald.",
    ],
    yogurtSteps: [
      "Önts 250 ml tejet a turmixgépbe, és adj hozzá 3–4 evőkanál görög joghurtot.",
      "Add hozzá a vendég által választott gyümölcsöt és a jeget.",
      "Turmixold simára és krémesre.",
      "Oszd el két pohárba, és tálald.",
    ],
    fruitSteps: [
      "Tegyél érett, lédús gyümölcsöt a turmixgépbe. Tejet vagy gyümölcslevet ne adj hozzá.",
      "Adj hozzá jeget és kevés kávéédesítőt.",
      "Turmixold vagy pulzáld simára; szükség esetén adj hozzá puhább gyümölcsöt.",
      "Oszd el két pohárba, és tálald.",
    ],
    note: "Elkészítés előtt kérdezz rá az allergiákra és étrendi igényekre. A tejturmixok és a joghurtos smoothie tejterméket, a Nutella mogyorót tartalmaz.",
  },
};

interface BreakfastRecipesProps {
  language: string;
}

export default function BreakfastRecipes({ language }: BreakfastRecipesProps) {
  const t = language === "hu" ? translations.hu : translations.en;
  const [drink, setDrink] = useState<DrinkType>("milkshake");
  const [flavor, setFlavor] = useState<MilkshakeFlavor>("strawberry");
  const [style, setStyle] = useState<SmoothieStyle>("juice");

  const recipe = drink === "milkshake"
    ? {
        title: t.milkshakeFlavors[flavor] + " " + t.milkshake,
        ingredients: [t.milk, t.iceCream, t.milkshakeIngredients[flavor], t.sweetener, t.ice],
        steps: t.milkshakeSteps,
      }
    : style === "juice"
      ? {
          title: t.smoothieNames.juice,
          ingredients: [t.juice, t.fruits, t.sweetener, t.ice],
          steps: t.juiceSteps,
        }
      : style === "yogurt"
        ? {
            title: t.smoothieNames.yogurt,
            ingredients: [t.milk, t.greekYogurt, t.fruits, t.ice],
            steps: t.yogurtSteps,
          }
        : {
            title: t.smoothieNames.fruit,
            ingredients: [t.juicyFruit, t.ice, t.littleSweetener],
            steps: t.fruitSteps,
          };

  const typeButtonClass = (active: boolean) => [
    "flex min-h-12 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2",
    active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60",
  ].join(" ");

  const choiceButtonClass = (active: boolean) => [
    "min-h-[64px] rounded-xl border px-3 py-2 text-left transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2",
    active ? "border-sky-500 bg-sky-50 text-sky-950 shadow-sm" : "border-border bg-background hover:border-sky-300 hover:bg-muted/40",
  ].join(" ");

  return (
    <section aria-labelledby="bb-recipes-title" className="space-y-4">
      <div className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 via-background to-background p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
              <ChefHat className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="bb-recipes-title" className="text-lg font-bold leading-tight">{t.heading}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.intro}</p>
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0 gap-1 whitespace-nowrap text-[11px]">
            <Users className="h-3 w-3" aria-hidden="true" />
            {t.portions}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="group" aria-label={t.heading}>
        <button type="button" aria-pressed={drink === "milkshake"} className={typeButtonClass(drink === "milkshake")} onClick={() => setDrink("milkshake")}>
          <GlassWater className="h-4 w-4" aria-hidden="true" />
          {t.milkshakes}
        </button>
        <button type="button" aria-pressed={drink === "smoothie"} className={typeButtonClass(drink === "smoothie")} onClick={() => setDrink("smoothie")}>
          <GlassWater className="h-4 w-4" aria-hidden="true" />
          {t.smoothies}
        </button>
      </div>

      {drink === "milkshake" ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t.chooseFlavor}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={t.chooseFlavor}>
            {milkshakeFlavors.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={flavor === key}
                className={choiceButtonClass(flavor === key)}
                onClick={() => setFlavor(key)}
              >
                <span className="flex items-center justify-between gap-1">
                  <span className="text-sm font-semibold">{t.milkshakeFlavors[key]}</span>
                  {flavor === key && <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t.chooseStyle}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label={t.chooseStyle}>
            {smoothieStyles.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={style === key}
                className={choiceButtonClass(style === key)}
                onClick={() => setStyle(key)}
              >
                <span className="flex items-center justify-between gap-1">
                  <span className="text-sm font-semibold leading-tight">{t.smoothieNames[key]}</span>
                  {style === key && <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{t.smoothieHints[key]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3 sm:px-5">
          <h3 className="text-base font-bold">{recipe.title}</h3>
          <Badge variant="outline" className="gap-1"><Users className="h-3 w-3" aria-hidden="true" />{t.portions}</Badge>
        </div>
        <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-2">
          <div>
            <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4 text-sky-600" aria-hidden="true" />
              {t.ingredients}
            </h4>
            <ul className="space-y-2">
              {recipe.ingredients.map((item, index) => (
                <li key={index} className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm leading-snug">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ChefHat className="h-4 w-4 text-sky-600" aria-hidden="true" />
              {t.steps}
            </h4>
            <ol className="space-y-3">
              {recipe.steps.map((step, index) => (
                <li key={index} className="flex items-start gap-3 text-sm leading-relaxed">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-800">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-950" role="note">
        {t.note}
      </p>
    </section>
  );
}
