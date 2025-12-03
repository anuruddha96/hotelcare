// Training guide translations for all supported languages

export type TrainingTranslations = {
  [stepKey: string]: {
    title: string;
    content: string;
    actionHint?: string;
  };
};

export type AllTrainingTranslations = {
  [langCode: string]: {
    ui: {
      nextButton: string;
      prevButton: string;
      skipButton: string;
      finishButton: string;
      exitButton: string;
      stepOf: string;
      trainingComplete: string;
      congratulations: string;
      startTraining: string;
      continueTraining: string;
      assignTraining: string;
      trainingAssigned: string;
      noTrainingAssigned: string;
      selectGuide: string;
      trainingProgress: string;
      completed: string;
      inProgress: string;
      notStarted: string;
      helpButton: string;
    };
    guides: {
      'getting-started': { name: string; description: string };
      'working-with-rooms': { name: string; description: string };
      'breaks-and-signout': { name: string; description: string };
      'special-situations': { name: string; description: string };
    };
    steps: TrainingTranslations;
  };
};

export const trainingTranslations: AllTrainingTranslations = {
  en: {
    ui: {
      nextButton: 'Next',
      prevButton: 'Back',
      skipButton: 'Skip',
      finishButton: 'Finish',
      exitButton: 'Exit Training',
      stepOf: 'Step {current} of {total}',
      trainingComplete: 'Training Complete!',
      congratulations: 'Congratulations! You have completed the training.',
      startTraining: 'Start Training',
      continueTraining: 'Continue Training',
      assignTraining: 'Assign Training',
      trainingAssigned: 'Training assigned successfully',
      noTrainingAssigned: 'No training assigned',
      selectGuide: 'Select a training guide',
      trainingProgress: 'Training Progress',
      completed: 'Completed',
      inProgress: 'In Progress',
      notStarted: 'Not Started',
      helpButton: 'Help & Training',
    },
    guides: {
      'getting-started': {
        name: 'Getting Started',
        description: 'Learn the basics of using the app',
      },
      'working-with-rooms': {
        name: 'Working with Rooms',
        description: 'How to clean and manage assigned rooms',
      },
      'breaks-and-signout': {
        name: 'Breaks & Sign-out',
        description: 'Managing your breaks and ending your shift',
      },
      'special-situations': {
        name: 'Special Situations',
        description: 'Handling DND rooms, maintenance issues, and lost items',
      },
    },
    steps: {
      // Getting Started
      welcome: {
        title: 'Welcome to HotelCare!',
        content: 'This training will guide you through the main features of the app. Let\'s get started!',
        actionHint: 'Click Next to continue',
      },
      check_in: {
        title: 'Check In to Work',
        content: 'Start your day by checking in. This button records your attendance and unlocks your assigned rooms.',
        actionHint: 'Tap this button when you arrive at work',
      },
      view_rooms: {
        title: 'View Your Rooms',
        content: 'The Rooms tab shows all rooms assigned to you for today. Each card displays important information about the room.',
        actionHint: 'Tap to see your assigned rooms',
      },
      room_card_info: {
        title: 'Understanding Room Cards',
        content: 'Each room card shows: room number, cleaning type (checkout/daily), priority level, and current status. Green means ready to clean!',
        actionHint: 'Look at the different badges and colors',
      },
      navigation: {
        title: 'App Navigation',
        content: 'Use these tabs to switch between different sections: your rooms, DND rooms, completed tasks, and more.',
        actionHint: 'Try tapping different tabs',
      },
      // Working with Rooms
      start_room: {
        title: 'Start Cleaning a Room',
        content: 'Press and hold this button for 2 seconds to start cleaning. This starts the timer and notifies supervisors.',
        actionHint: 'Press and hold to start',
      },
      capture_photos: {
        title: 'Capture Room Photos',
        content: 'Take photos of the room before and after cleaning. This is required for quality assurance.',
        actionHint: 'Tap to open the camera',
      },
      dirty_linen: {
        title: 'Record Dirty Linen',
        content: 'Count and record the dirty linen you collect from this room. This helps with laundry tracking.',
        actionHint: 'Tap to add linen counts',
      },
      mark_dnd: {
        title: 'Mark Room as DND',
        content: 'If guests have the Do Not Disturb sign, take a photo of the sign and mark the room as DND.',
        actionHint: 'Use when you see the DND sign',
      },
      maintenance: {
        title: 'Report Maintenance Issues',
        content: 'Found something broken? Report it here with a description and photo. The maintenance team will be notified.',
        actionHint: 'Report any issues you find',
      },
      lost_found: {
        title: 'Log Lost & Found Items',
        content: 'If you find any items left by guests, log them here with a photo and description.',
        actionHint: 'Record found items',
      },
      add_notes: {
        title: 'Add Notes',
        content: 'Add any special notes about the room that supervisors or the next shift should know about.',
        actionHint: 'Write important observations',
      },
      complete_room: {
        title: 'Complete the Room',
        content: 'When finished cleaning, press and hold to mark the room as complete. Make sure you\'ve taken all required photos!',
        actionHint: 'Press and hold to complete',
      },
      // Breaks & Sign-out
      request_break: {
        title: 'Take a Break',
        content: 'Need a break? Tap this button to request one. Your supervisor may need to approve it.',
        actionHint: 'Request your break here',
      },
      select_break_type: {
        title: 'Select Break Type',
        content: 'Choose the type of break: lunch break, short break, or other. Each has a different duration.',
        actionHint: 'Select the appropriate break type',
      },
      end_break: {
        title: 'End Your Break',
        content: 'When your break is over, swipe this button to end it and return to work.',
        actionHint: 'Swipe to end break',
      },
      sign_out: {
        title: 'Sign Out',
        content: 'At the end of your shift, tap here to sign out. Make sure all your rooms are completed first!',
        actionHint: 'Sign out when your shift ends',
      },
      // Special Situations
      retrieve_dnd: {
        title: 'DND Rooms List',
        content: 'This tab shows all rooms marked as Do Not Disturb. When guests remove the sign, you can retrieve the room and clean it.',
        actionHint: 'Check for rooms ready to clean',
      },
      priority_rooms: {
        title: 'Priority Rooms',
        content: 'Rooms with high priority badges should be cleaned first. These might be VIP guests or early check-ins.',
        actionHint: 'Clean priority rooms first',
      },
      checkout_daily: {
        title: 'Checkout vs Daily Clean',
        content: 'Checkout rooms need full cleaning with linen change. Daily cleaning rooms are for occupied rooms with lighter cleaning.',
        actionHint: 'Check the room type badge',
      },
      completed_tasks: {
        title: 'View Completed Work',
        content: 'See all the rooms you\'ve completed today. You can review details and photos.',
        actionHint: 'Review your completed work',
      },
      contact_supervisor: {
        title: 'Get Help',
        content: 'Need help? Use the help button to access training guides or contact your supervisor.',
        actionHint: 'Tap when you need assistance',
      },
    },
  },
  cs: {
    ui: {
      nextButton: 'Další',
      prevButton: 'Zpět',
      skipButton: 'Přeskočit',
      finishButton: 'Dokončit',
      exitButton: 'Ukončit školení',
      stepOf: 'Krok {current} z {total}',
      trainingComplete: 'Školení dokončeno!',
      congratulations: 'Gratulujeme! Dokončili jste školení.',
      startTraining: 'Zahájit školení',
      continueTraining: 'Pokračovat ve školení',
      assignTraining: 'Přiřadit školení',
      trainingAssigned: 'Školení úspěšně přiřazeno',
      noTrainingAssigned: 'Žádné přiřazené školení',
      selectGuide: 'Vyberte průvodce školením',
      trainingProgress: 'Průběh školení',
      completed: 'Dokončeno',
      inProgress: 'Probíhá',
      notStarted: 'Nezahájeno',
      helpButton: 'Nápověda a školení',
    },
    guides: {
      'getting-started': {
        name: 'Začínáme',
        description: 'Naučte se základy používání aplikace',
      },
      'working-with-rooms': {
        name: 'Práce s pokoji',
        description: 'Jak uklízet a spravovat přidělené pokoje',
      },
      'breaks-and-signout': {
        name: 'Přestávky a odhlášení',
        description: 'Správa přestávek a ukončení směny',
      },
      'special-situations': {
        name: 'Speciální situace',
        description: 'Řešení DND pokojů, údržby a nalezených předmětů',
      },
    },
    steps: {
      welcome: {
        title: 'Vítejte v HotelCare!',
        content: 'Toto školení vás provede hlavními funkcemi aplikace. Pojďme začít!',
        actionHint: 'Klikněte na Další pro pokračování',
      },
      check_in: {
        title: 'Příchod do práce',
        content: 'Začněte den přihlášením. Toto tlačítko zaznamená vaši docházku a odemkne přidělené pokoje.',
        actionHint: 'Klepněte na toto tlačítko při příchodu do práce',
      },
      view_rooms: {
        title: 'Zobrazit vaše pokoje',
        content: 'Záložka Pokoje zobrazuje všechny pokoje přidělené na dnešek. Každá karta obsahuje důležité informace.',
        actionHint: 'Klepněte pro zobrazení přidělených pokojů',
      },
      room_card_info: {
        title: 'Porozumění kartám pokojů',
        content: 'Každá karta pokoje zobrazuje: číslo pokoje, typ úklidu, prioritu a aktuální stav. Zelená znamená připraveno k úklidu!',
        actionHint: 'Prohlédněte si různé štítky a barvy',
      },
      navigation: {
        title: 'Navigace v aplikaci',
        content: 'Použijte tyto záložky pro přepínání mezi sekcemi: vaše pokoje, DND pokoje, dokončené úkoly a další.',
        actionHint: 'Zkuste klepnout na různé záložky',
      },
      start_room: {
        title: 'Začít úklid pokoje',
        content: 'Stiskněte a podržte toto tlačítko 2 sekundy pro zahájení úklidu. Spustí se časovač a budou informováni nadřízení.',
        actionHint: 'Stiskněte a podržte pro zahájení',
      },
      capture_photos: {
        title: 'Pořiďte fotky pokoje',
        content: 'Pořiďte fotky pokoje před a po úklidu. Je to vyžadováno pro kontrolu kvality.',
        actionHint: 'Klepněte pro otevření fotoaparátu',
      },
      dirty_linen: {
        title: 'Zaznamenat špinavé prádlo',
        content: 'Spočítejte a zaznamenejte špinavé prádlo z tohoto pokoje. Pomáhá to se sledováním prádla.',
        actionHint: 'Klepněte pro přidání počtu prádla',
      },
      mark_dnd: {
        title: 'Označit pokoj jako DND',
        content: 'Pokud hosté mají ceduli Nerušit, vyfoťte ji a označte pokoj jako DND.',
        actionHint: 'Použijte, když vidíte ceduli DND',
      },
      maintenance: {
        title: 'Nahlásit problém údržby',
        content: 'Našli jste něco rozbitého? Nahlaste to zde s popisem a fotkou. Tým údržby bude informován.',
        actionHint: 'Nahlaste nalezené problémy',
      },
      lost_found: {
        title: 'Zaznamenat ztráty a nálezy',
        content: 'Pokud najdete předměty ponechané hosty, zaznamenejte je zde s fotkou a popisem.',
        actionHint: 'Zaznamenejte nalezené předměty',
      },
      add_notes: {
        title: 'Přidat poznámky',
        content: 'Přidejte speciální poznámky o pokoji, které by měli vědět nadřízení nebo další směna.',
        actionHint: 'Napište důležitá pozorování',
      },
      complete_room: {
        title: 'Dokončit pokoj',
        content: 'Po dokončení úklidu stiskněte a podržte pro označení pokoje jako hotový. Ujistěte se, že jste pořídili všechny požadované fotky!',
        actionHint: 'Stiskněte a podržte pro dokončení',
      },
      request_break: {
        title: 'Vzít si přestávku',
        content: 'Potřebujete přestávku? Klepněte na toto tlačítko pro vyžádání. Váš nadřízený ji možná bude muset schválit.',
        actionHint: 'Zde požádejte o přestávku',
      },
      select_break_type: {
        title: 'Vybrat typ přestávky',
        content: 'Vyberte typ přestávky: obědová, krátká nebo jiná. Každá má jinou dobu trvání.',
        actionHint: 'Vyberte příslušný typ přestávky',
      },
      end_break: {
        title: 'Ukončit přestávku',
        content: 'Když přestávka skončí, přejeďte tímto tlačítkem pro její ukončení a návrat do práce.',
        actionHint: 'Přejeďte pro ukončení přestávky',
      },
      sign_out: {
        title: 'Odhlásit se',
        content: 'Na konci směny klepněte zde pro odhlášení. Ujistěte se, že jsou všechny pokoje dokončeny!',
        actionHint: 'Odhlaste se na konci směny',
      },
      retrieve_dnd: {
        title: 'Seznam DND pokojů',
        content: 'Tato záložka zobrazuje všechny pokoje označené jako Nerušit. Když hosté odstraní ceduli, můžete pokoj uklízet.',
        actionHint: 'Zkontrolujte pokoje připravené k úklidu',
      },
      priority_rooms: {
        title: 'Prioritní pokoje',
        content: 'Pokoje s vysokou prioritou by měly být uklizeny první. Mohou to být VIP hosté nebo brzké příjezdy.',
        actionHint: 'Uklízejte nejprve prioritní pokoje',
      },
      checkout_daily: {
        title: 'Checkout vs denní úklid',
        content: 'Checkout pokoje vyžadují plný úklid s výměnou prádla. Denní úklid je pro obsazené pokoje s lehčím úklidem.',
        actionHint: 'Zkontrolujte štítek typu pokoje',
      },
      completed_tasks: {
        title: 'Zobrazit dokončenou práci',
        content: 'Podívejte se na všechny pokoje, které jste dnes dokončili. Můžete si prohlédnout detaily a fotky.',
        actionHint: 'Zkontrolujte dokončenou práci',
      },
      contact_supervisor: {
        title: 'Získat pomoc',
        content: 'Potřebujete pomoc? Použijte tlačítko nápovědy pro přístup ke školením nebo kontaktujte nadřízeného.',
        actionHint: 'Klepněte, když potřebujete pomoc',
      },
    },
  },
  uk: {
    ui: {
      nextButton: 'Далі',
      prevButton: 'Назад',
      skipButton: 'Пропустити',
      finishButton: 'Завершити',
      exitButton: 'Вийти з навчання',
      stepOf: 'Крок {current} з {total}',
      trainingComplete: 'Навчання завершено!',
      congratulations: 'Вітаємо! Ви завершили навчання.',
      startTraining: 'Почати навчання',
      continueTraining: 'Продовжити навчання',
      assignTraining: 'Призначити навчання',
      trainingAssigned: 'Навчання успішно призначено',
      noTrainingAssigned: 'Навчання не призначено',
      selectGuide: 'Виберіть посібник',
      trainingProgress: 'Прогрес навчання',
      completed: 'Завершено',
      inProgress: 'В процесі',
      notStarted: 'Не розпочато',
      helpButton: 'Допомога та навчання',
    },
    guides: {
      'getting-started': {
        name: 'Початок роботи',
        description: 'Вивчіть основи використання додатку',
      },
      'working-with-rooms': {
        name: 'Робота з кімнатами',
        description: 'Як прибирати та керувати призначеними кімнатами',
      },
      'breaks-and-signout': {
        name: 'Перерви та вихід',
        description: 'Керування перервами та завершення зміни',
      },
      'special-situations': {
        name: 'Особливі ситуації',
        description: 'Робота з DND кімнатами, техобслуговуванням та знахідками',
      },
    },
    steps: {
      welcome: {
        title: 'Ласкаво просимо до HotelCare!',
        content: 'Це навчання проведе вас через основні функції додатку. Почнімо!',
        actionHint: 'Натисніть Далі для продовження',
      },
      check_in: {
        title: 'Відмітитися на роботі',
        content: 'Почніть день з відмітки. Ця кнопка записує вашу присутність та відкриває призначені кімнати.',
        actionHint: 'Натисніть цю кнопку, коли прийдете на роботу',
      },
      view_rooms: {
        title: 'Переглянути ваші кімнати',
        content: 'Вкладка Кімнати показує всі кімнати, призначені вам на сьогодні. Кожна картка містить важливу інформацію.',
        actionHint: 'Натисніть, щоб побачити призначені кімнати',
      },
      room_card_info: {
        title: 'Розуміння карток кімнат',
        content: 'Кожна картка кімнати показує: номер кімнати, тип прибирання, пріоритет та поточний статус. Зелений означає готово до прибирання!',
        actionHint: 'Подивіться на різні значки та кольори',
      },
      navigation: {
        title: 'Навігація додатком',
        content: 'Використовуйте ці вкладки для перемикання між розділами: ваші кімнати, DND кімнати, завершені завдання тощо.',
        actionHint: 'Спробуйте натиснути різні вкладки',
      },
      start_room: {
        title: 'Почати прибирання кімнати',
        content: 'Натисніть і утримуйте цю кнопку 2 секунди, щоб почати прибирання. Це запускає таймер і сповіщає супервайзерів.',
        actionHint: 'Натисніть і утримуйте для початку',
      },
      capture_photos: {
        title: 'Зробіть фото кімнати',
        content: 'Зробіть фото кімнати до і після прибирання. Це потрібно для контролю якості.',
        actionHint: 'Натисніть, щоб відкрити камеру',
      },
      dirty_linen: {
        title: 'Записати брудну білизну',
        content: 'Порахуйте та запишіть брудну білизну з цієї кімнати. Це допомагає відстежувати пральню.',
        actionHint: 'Натисніть, щоб додати кількість білизни',
      },
      mark_dnd: {
        title: 'Позначити кімнату як DND',
        content: 'Якщо гості мають табличку Не турбувати, сфотографуйте її та позначте кімнату як DND.',
        actionHint: 'Використовуйте, коли бачите табличку DND',
      },
      maintenance: {
        title: 'Повідомити про проблему',
        content: 'Знайшли щось зламане? Повідомте тут з описом та фото. Команду техобслуговування буде сповіщено.',
        actionHint: 'Повідомте про знайдені проблеми',
      },
      lost_found: {
        title: 'Записати знахідки',
        content: 'Якщо ви знайшли речі, залишені гостями, запишіть їх тут з фото та описом.',
        actionHint: 'Запишіть знайдені речі',
      },
      add_notes: {
        title: 'Додати нотатки',
        content: 'Додайте спеціальні нотатки про кімнату, які повинні знати супервайзери або наступна зміна.',
        actionHint: 'Напишіть важливі спостереження',
      },
      complete_room: {
        title: 'Завершити кімнату',
        content: 'Коли прибирання закінчено, натисніть і утримуйте, щоб позначити кімнату як завершену. Переконайтеся, що зробили всі необхідні фото!',
        actionHint: 'Натисніть і утримуйте для завершення',
      },
      request_break: {
        title: 'Взяти перерву',
        content: 'Потрібна перерва? Натисніть цю кнопку, щоб запросити її. Ваш супервайзер може потребувати її схвалити.',
        actionHint: 'Запросіть перерву тут',
      },
      select_break_type: {
        title: 'Вибрати тип перерви',
        content: 'Виберіть тип перерви: обідня, коротка або інша. Кожна має різну тривалість.',
        actionHint: 'Виберіть відповідний тип перерви',
      },
      end_break: {
        title: 'Завершити перерву',
        content: 'Коли перерва закінчилася, проведіть по цій кнопці, щоб завершити її та повернутися до роботи.',
        actionHint: 'Проведіть, щоб завершити перерву',
      },
      sign_out: {
        title: 'Вийти',
        content: 'В кінці зміни натисніть тут, щоб вийти. Переконайтеся, що всі кімнати завершені!',
        actionHint: 'Вийдіть, коли зміна закінчується',
      },
      retrieve_dnd: {
        title: 'Список DND кімнат',
        content: 'Ця вкладка показує всі кімнати, позначені як Не турбувати. Коли гості знімають табличку, ви можете прибрати кімнату.',
        actionHint: 'Перевірте кімнати, готові до прибирання',
      },
      priority_rooms: {
        title: 'Пріоритетні кімнати',
        content: 'Кімнати з високим пріоритетом повинні бути прибрані першими. Це можуть бути VIP гості або ранні заїзди.',
        actionHint: 'Прибирайте пріоритетні кімнати першими',
      },
      checkout_daily: {
        title: 'Виїзд vs щоденне прибирання',
        content: 'Кімнати виїзду потребують повного прибирання зі зміною білизни. Щоденне прибирання для зайнятих кімнат з легшим прибиранням.',
        actionHint: 'Перевірте значок типу кімнати',
      },
      completed_tasks: {
        title: 'Переглянути виконану роботу',
        content: 'Перегляньте всі кімнати, які ви завершили сьогодні. Можете переглянути деталі та фото.',
        actionHint: 'Перегляньте виконану роботу',
      },
      contact_supervisor: {
        title: 'Отримати допомогу',
        content: 'Потрібна допомога? Використовуйте кнопку допомоги для доступу до навчань або зв\'яжіться з супервайзером.',
        actionHint: 'Натисніть, коли потрібна допомога',
      },
    },
  },
  ru: {
    ui: {
      nextButton: 'Далее',
      prevButton: 'Назад',
      skipButton: 'Пропустить',
      finishButton: 'Завершить',
      exitButton: 'Выйти из обучения',
      stepOf: 'Шаг {current} из {total}',
      trainingComplete: 'Обучение завершено!',
      congratulations: 'Поздравляем! Вы завершили обучение.',
      startTraining: 'Начать обучение',
      continueTraining: 'Продолжить обучение',
      assignTraining: 'Назначить обучение',
      trainingAssigned: 'Обучение успешно назначено',
      noTrainingAssigned: 'Обучение не назначено',
      selectGuide: 'Выберите руководство',
      trainingProgress: 'Прогресс обучения',
      completed: 'Завершено',
      inProgress: 'В процессе',
      notStarted: 'Не начато',
      helpButton: 'Помощь и обучение',
    },
    guides: {
      'getting-started': {
        name: 'Начало работы',
        description: 'Изучите основы использования приложения',
      },
      'working-with-rooms': {
        name: 'Работа с номерами',
        description: 'Как убирать и управлять назначенными номерами',
      },
      'breaks-and-signout': {
        name: 'Перерывы и выход',
        description: 'Управление перерывами и завершение смены',
      },
      'special-situations': {
        name: 'Особые ситуации',
        description: 'Работа с DND номерами, обслуживанием и находками',
      },
    },
    steps: {
      welcome: {
        title: 'Добро пожаловать в HotelCare!',
        content: 'Это обучение проведёт вас через основные функции приложения. Давайте начнём!',
        actionHint: 'Нажмите Далее для продолжения',
      },
      check_in: {
        title: 'Отметиться на работе',
        content: 'Начните день с отметки. Эта кнопка записывает вашу посещаемость и открывает назначенные номера.',
        actionHint: 'Нажмите эту кнопку, когда придёте на работу',
      },
      view_rooms: {
        title: 'Просмотреть ваши номера',
        content: 'Вкладка Номера показывает все номера, назначенные вам на сегодня. Каждая карточка содержит важную информацию.',
        actionHint: 'Нажмите, чтобы увидеть назначенные номера',
      },
      room_card_info: {
        title: 'Понимание карточек номеров',
        content: 'Каждая карточка номера показывает: номер комнаты, тип уборки, приоритет и текущий статус. Зелёный означает готово к уборке!',
        actionHint: 'Посмотрите на разные значки и цвета',
      },
      navigation: {
        title: 'Навигация по приложению',
        content: 'Используйте эти вкладки для переключения между разделами: ваши номера, DND номера, завершённые задачи и др.',
        actionHint: 'Попробуйте нажать разные вкладки',
      },
      start_room: {
        title: 'Начать уборку номера',
        content: 'Нажмите и удерживайте эту кнопку 2 секунды, чтобы начать уборку. Это запускает таймер и уведомляет супервайзеров.',
        actionHint: 'Нажмите и удерживайте для начала',
      },
      capture_photos: {
        title: 'Сделайте фото номера',
        content: 'Сделайте фото номера до и после уборки. Это требуется для контроля качества.',
        actionHint: 'Нажмите, чтобы открыть камеру',
      },
      dirty_linen: {
        title: 'Записать грязное бельё',
        content: 'Посчитайте и запишите грязное бельё из этого номера. Это помогает отслеживать прачечную.',
        actionHint: 'Нажмите, чтобы добавить количество белья',
      },
      mark_dnd: {
        title: 'Отметить номер как DND',
        content: 'Если у гостей табличка Не беспокоить, сфотографируйте её и отметьте номер как DND.',
        actionHint: 'Используйте, когда видите табличку DND',
      },
      maintenance: {
        title: 'Сообщить о проблеме',
        content: 'Нашли что-то сломанное? Сообщите здесь с описанием и фото. Команда обслуживания будет уведомлена.',
        actionHint: 'Сообщите о найденных проблемах',
      },
      lost_found: {
        title: 'Записать находки',
        content: 'Если вы нашли вещи, оставленные гостями, запишите их здесь с фото и описанием.',
        actionHint: 'Запишите найденные вещи',
      },
      add_notes: {
        title: 'Добавить заметки',
        content: 'Добавьте специальные заметки о номере, которые должны знать супервайзеры или следующая смена.',
        actionHint: 'Напишите важные наблюдения',
      },
      complete_room: {
        title: 'Завершить номер',
        content: 'Когда уборка закончена, нажмите и удерживайте, чтобы отметить номер как завершённый. Убедитесь, что сделали все необходимые фото!',
        actionHint: 'Нажмите и удерживайте для завершения',
      },
      request_break: {
        title: 'Взять перерыв',
        content: 'Нужен перерыв? Нажмите эту кнопку, чтобы запросить его. Ваш супервайзер может потребоваться для одобрения.',
        actionHint: 'Запросите перерыв здесь',
      },
      select_break_type: {
        title: 'Выбрать тип перерыва',
        content: 'Выберите тип перерыва: обеденный, короткий или другой. Каждый имеет разную продолжительность.',
        actionHint: 'Выберите соответствующий тип перерыва',
      },
      end_break: {
        title: 'Завершить перерыв',
        content: 'Когда перерыв закончился, проведите по этой кнопке, чтобы завершить его и вернуться к работе.',
        actionHint: 'Проведите, чтобы завершить перерыв',
      },
      sign_out: {
        title: 'Выйти',
        content: 'В конце смены нажмите здесь, чтобы выйти. Убедитесь, что все номера завершены!',
        actionHint: 'Выйдите, когда смена заканчивается',
      },
      retrieve_dnd: {
        title: 'Список DND номеров',
        content: 'Эта вкладка показывает все номера, отмеченные как Не беспокоить. Когда гости снимают табличку, вы можете убрать номер.',
        actionHint: 'Проверьте номера, готовые к уборке',
      },
      priority_rooms: {
        title: 'Приоритетные номера',
        content: 'Номера с высоким приоритетом должны быть убраны первыми. Это могут быть VIP гости или ранние заезды.',
        actionHint: 'Убирайте приоритетные номера первыми',
      },
      checkout_daily: {
        title: 'Выезд vs ежедневная уборка',
        content: 'Номера выезда требуют полной уборки со сменой белья. Ежедневная уборка для занятых номеров с лёгкой уборкой.',
        actionHint: 'Проверьте значок типа номера',
      },
      completed_tasks: {
        title: 'Просмотреть выполненную работу',
        content: 'Посмотрите все номера, которые вы завершили сегодня. Можете просмотреть детали и фото.',
        actionHint: 'Просмотрите выполненную работу',
      },
      contact_supervisor: {
        title: 'Получить помощь',
        content: 'Нужна помощь? Используйте кнопку помощи для доступа к обучениям или свяжитесь с супервайзером.',
        actionHint: 'Нажмите, когда нужна помощь',
      },
    },
  },
  vi: {
    ui: {
      nextButton: 'Tiếp theo',
      prevButton: 'Quay lại',
      skipButton: 'Bỏ qua',
      finishButton: 'Hoàn thành',
      exitButton: 'Thoát đào tạo',
      stepOf: 'Bước {current} / {total}',
      trainingComplete: 'Hoàn thành đào tạo!',
      congratulations: 'Chúc mừng! Bạn đã hoàn thành đào tạo.',
      startTraining: 'Bắt đầu đào tạo',
      continueTraining: 'Tiếp tục đào tạo',
      assignTraining: 'Giao đào tạo',
      trainingAssigned: 'Đã giao đào tạo thành công',
      noTrainingAssigned: 'Chưa được giao đào tạo',
      selectGuide: 'Chọn hướng dẫn',
      trainingProgress: 'Tiến độ đào tạo',
      completed: 'Hoàn thành',
      inProgress: 'Đang tiến hành',
      notStarted: 'Chưa bắt đầu',
      helpButton: 'Trợ giúp & Đào tạo',
    },
    guides: {
      'getting-started': {
        name: 'Bắt đầu',
        description: 'Học cách sử dụng ứng dụng cơ bản',
      },
      'working-with-rooms': {
        name: 'Làm việc với phòng',
        description: 'Cách dọn dẹp và quản lý phòng được giao',
      },
      'breaks-and-signout': {
        name: 'Nghỉ giải lao & Kết thúc',
        description: 'Quản lý giờ nghỉ và kết thúc ca làm',
      },
      'special-situations': {
        name: 'Tình huống đặc biệt',
        description: 'Xử lý phòng DND, bảo trì và đồ thất lạc',
      },
    },
    steps: {
      welcome: {
        title: 'Chào mừng đến với HotelCare!',
        content: 'Khóa đào tạo này sẽ hướng dẫn bạn các tính năng chính của ứng dụng. Hãy bắt đầu!',
        actionHint: 'Nhấn Tiếp theo để tiếp tục',
      },
      check_in: {
        title: 'Chấm công vào ca',
        content: 'Bắt đầu ngày làm việc bằng cách chấm công. Nút này ghi lại sự có mặt và mở khóa các phòng được giao.',
        actionHint: 'Nhấn nút này khi bạn đến làm việc',
      },
      view_rooms: {
        title: 'Xem phòng của bạn',
        content: 'Tab Phòng hiển thị tất cả phòng được giao cho bạn hôm nay. Mỗi thẻ chứa thông tin quan trọng.',
        actionHint: 'Nhấn để xem phòng được giao',
      },
      room_card_info: {
        title: 'Hiểu thẻ phòng',
        content: 'Mỗi thẻ phòng hiển thị: số phòng, loại dọn dẹp, mức ưu tiên và trạng thái. Màu xanh nghĩa là sẵn sàng dọn!',
        actionHint: 'Xem các huy hiệu và màu sắc khác nhau',
      },
      navigation: {
        title: 'Điều hướng ứng dụng',
        content: 'Sử dụng các tab này để chuyển đổi giữa các phần: phòng của bạn, phòng DND, công việc hoàn thành, v.v.',
        actionHint: 'Thử nhấn các tab khác nhau',
      },
      start_room: {
        title: 'Bắt đầu dọn phòng',
        content: 'Nhấn và giữ nút này 2 giây để bắt đầu dọn. Điều này khởi động bộ đếm thời gian và thông báo cho quản lý.',
        actionHint: 'Nhấn và giữ để bắt đầu',
      },
      capture_photos: {
        title: 'Chụp ảnh phòng',
        content: 'Chụp ảnh phòng trước và sau khi dọn. Đây là yêu cầu để kiểm soát chất lượng.',
        actionHint: 'Nhấn để mở camera',
      },
      dirty_linen: {
        title: 'Ghi đồ vải bẩn',
        content: 'Đếm và ghi lại đồ vải bẩn từ phòng này. Điều này giúp theo dõi giặt ủi.',
        actionHint: 'Nhấn để thêm số lượng đồ vải',
      },
      mark_dnd: {
        title: 'Đánh dấu phòng DND',
        content: 'Nếu khách có biển Không làm phiền, chụp ảnh biển và đánh dấu phòng là DND.',
        actionHint: 'Sử dụng khi thấy biển DND',
      },
      maintenance: {
        title: 'Báo cáo sự cố',
        content: 'Tìm thấy thứ gì đó hỏng? Báo cáo ở đây với mô tả và ảnh. Nhóm bảo trì sẽ được thông báo.',
        actionHint: 'Báo cáo các vấn đề tìm thấy',
      },
      lost_found: {
        title: 'Ghi đồ thất lạc',
        content: 'Nếu bạn tìm thấy đồ khách để lại, ghi lại ở đây với ảnh và mô tả.',
        actionHint: 'Ghi lại đồ tìm được',
      },
      add_notes: {
        title: 'Thêm ghi chú',
        content: 'Thêm ghi chú đặc biệt về phòng mà quản lý hoặc ca sau cần biết.',
        actionHint: 'Viết các quan sát quan trọng',
      },
      complete_room: {
        title: 'Hoàn thành phòng',
        content: 'Khi dọn xong, nhấn và giữ để đánh dấu phòng hoàn thành. Đảm bảo bạn đã chụp tất cả ảnh cần thiết!',
        actionHint: 'Nhấn và giữ để hoàn thành',
      },
      request_break: {
        title: 'Nghỉ giải lao',
        content: 'Cần nghỉ? Nhấn nút này để yêu cầu. Quản lý có thể cần phê duyệt.',
        actionHint: 'Yêu cầu nghỉ ở đây',
      },
      select_break_type: {
        title: 'Chọn loại nghỉ',
        content: 'Chọn loại nghỉ: nghỉ trưa, nghỉ ngắn hoặc khác. Mỗi loại có thời gian khác nhau.',
        actionHint: 'Chọn loại nghỉ phù hợp',
      },
      end_break: {
        title: 'Kết thúc nghỉ',
        content: 'Khi hết giờ nghỉ, vuốt nút này để kết thúc và quay lại làm việc.',
        actionHint: 'Vuốt để kết thúc nghỉ',
      },
      sign_out: {
        title: 'Kết thúc ca',
        content: 'Cuối ca làm, nhấn đây để kết thúc. Đảm bảo tất cả phòng đã hoàn thành!',
        actionHint: 'Kết thúc ca khi xong việc',
      },
      retrieve_dnd: {
        title: 'Danh sách phòng DND',
        content: 'Tab này hiển thị tất cả phòng đánh dấu Không làm phiền. Khi khách gỡ biển, bạn có thể dọn phòng.',
        actionHint: 'Kiểm tra phòng sẵn sàng dọn',
      },
      priority_rooms: {
        title: 'Phòng ưu tiên',
        content: 'Phòng có huy hiệu ưu tiên cao nên được dọn trước. Có thể là khách VIP hoặc check-in sớm.',
        actionHint: 'Dọn phòng ưu tiên trước',
      },
      checkout_daily: {
        title: 'Checkout vs Dọn hàng ngày',
        content: 'Phòng checkout cần dọn đầy đủ với thay đồ vải. Dọn hàng ngày cho phòng có khách với việc dọn nhẹ hơn.',
        actionHint: 'Kiểm tra huy hiệu loại phòng',
      },
      completed_tasks: {
        title: 'Xem công việc đã làm',
        content: 'Xem tất cả phòng bạn đã hoàn thành hôm nay. Bạn có thể xem chi tiết và ảnh.',
        actionHint: 'Xem lại công việc đã làm',
      },
      contact_supervisor: {
        title: 'Nhận trợ giúp',
        content: 'Cần giúp đỡ? Dùng nút trợ giúp để truy cập hướng dẫn đào tạo hoặc liên hệ quản lý.',
        actionHint: 'Nhấn khi cần hỗ trợ',
      },
    },
  },
  hi: {
    ui: {
      nextButton: 'अगला',
      prevButton: 'पीछे',
      skipButton: 'छोड़ें',
      finishButton: 'समाप्त',
      exitButton: 'प्रशिक्षण से बाहर',
      stepOf: 'चरण {current} का {total}',
      trainingComplete: 'प्रशिक्षण पूर्ण!',
      congratulations: 'बधाई! आपने प्रशिक्षण पूरा कर लिया।',
      startTraining: 'प्रशिक्षण शुरू करें',
      continueTraining: 'प्रशिक्षण जारी रखें',
      assignTraining: 'प्रशिक्षण असाइन करें',
      trainingAssigned: 'प्रशिक्षण सफलतापूर्वक असाइन किया गया',
      noTrainingAssigned: 'कोई प्रशिक्षण असाइन नहीं',
      selectGuide: 'गाइड चुनें',
      trainingProgress: 'प्रशिक्षण प्रगति',
      completed: 'पूर्ण',
      inProgress: 'जारी',
      notStarted: 'शुरू नहीं',
      helpButton: 'मदद और प्रशिक्षण',
    },
    guides: {
      'getting-started': {
        name: 'शुरुआत',
        description: 'ऐप की मूल बातें सीखें',
      },
      'working-with-rooms': {
        name: 'कमरों के साथ काम',
        description: 'असाइन किए गए कमरों को कैसे साफ करें और प्रबंधित करें',
      },
      'breaks-and-signout': {
        name: 'ब्रेक और साइन-आउट',
        description: 'अपने ब्रेक और शिफ्ट समाप्त करना',
      },
      'special-situations': {
        name: 'विशेष स्थितियां',
        description: 'DND कमरे, रखरखाव और खोई वस्तुओं को संभालना',
      },
    },
    steps: {
      welcome: {
        title: 'HotelCare में आपका स्वागत है!',
        content: 'यह प्रशिक्षण आपको ऐप की मुख्य सुविधाओं के बारे में मार्गदर्शन करेगा। चलिए शुरू करते हैं!',
        actionHint: 'जारी रखने के लिए अगला क्लिक करें',
      },
      check_in: {
        title: 'काम पर चेक इन करें',
        content: 'चेक इन करके अपना दिन शुरू करें। यह बटन आपकी उपस्थिति दर्ज करता है और असाइन किए गए कमरे अनलॉक करता है।',
        actionHint: 'काम पर आने पर इस बटन को टैप करें',
      },
      view_rooms: {
        title: 'अपने कमरे देखें',
        content: 'कमरे टैब आज के लिए आपको असाइन किए गए सभी कमरे दिखाता है। प्रत्येक कार्ड में महत्वपूर्ण जानकारी होती है।',
        actionHint: 'असाइन किए गए कमरे देखने के लिए टैप करें',
      },
      room_card_info: {
        title: 'कमरा कार्ड समझना',
        content: 'प्रत्येक कमरा कार्ड दिखाता है: कमरा नंबर, सफाई प्रकार, प्राथमिकता और वर्तमान स्थिति। हरा मतलब सफाई के लिए तैयार!',
        actionHint: 'विभिन्न बैज और रंग देखें',
      },
      navigation: {
        title: 'ऐप नेविगेशन',
        content: 'विभिन्न अनुभागों के बीच स्विच करने के लिए इन टैब का उपयोग करें: आपके कमरे, DND कमरे, पूर्ण कार्य, आदि।',
        actionHint: 'विभिन्न टैब टैप करके देखें',
      },
      start_room: {
        title: 'कमरे की सफाई शुरू करें',
        content: 'सफाई शुरू करने के लिए इस बटन को 2 सेकंड दबाए रखें। यह टाइमर शुरू करता है और पर्यवेक्षकों को सूचित करता है।',
        actionHint: 'शुरू करने के लिए दबाकर रखें',
      },
      capture_photos: {
        title: 'कमरे की फोटो लें',
        content: 'सफाई से पहले और बाद में कमरे की फोटो लें। गुणवत्ता आश्वासन के लिए यह आवश्यक है।',
        actionHint: 'कैमरा खोलने के लिए टैप करें',
      },
      dirty_linen: {
        title: 'गंदी चादर रिकॉर्ड करें',
        content: 'इस कमरे से गंदी चादर गिनें और रिकॉर्ड करें। यह लॉन्ड्री ट्रैकिंग में मदद करता है।',
        actionHint: 'चादर गिनती जोड़ने के लिए टैप करें',
      },
      mark_dnd: {
        title: 'कमरे को DND चिह्नित करें',
        content: 'अगर मेहमानों के पास परेशान न करें का चिन्ह है, तो चिन्ह की फोटो लें और कमरे को DND चिह्नित करें।',
        actionHint: 'DND चिन्ह देखने पर उपयोग करें',
      },
      maintenance: {
        title: 'रखरखाव समस्या रिपोर्ट करें',
        content: 'कुछ टूटा मिला? विवरण और फोटो के साथ यहां रिपोर्ट करें। रखरखाव टीम को सूचित किया जाएगा।',
        actionHint: 'मिली समस्याओं की रिपोर्ट करें',
      },
      lost_found: {
        title: 'खोई और पाई वस्तुएं लॉग करें',
        content: 'अगर आपको मेहमानों की छोड़ी वस्तुएं मिलती हैं, तो फोटो और विवरण के साथ यहां लॉग करें।',
        actionHint: 'मिली वस्तुएं रिकॉर्ड करें',
      },
      add_notes: {
        title: 'नोट्स जोड़ें',
        content: 'कमरे के बारे में विशेष नोट्स जोड़ें जो पर्यवेक्षकों या अगली शिफ्ट को पता होने चाहिए।',
        actionHint: 'महत्वपूर्ण अवलोकन लिखें',
      },
      complete_room: {
        title: 'कमरा पूरा करें',
        content: 'सफाई समाप्त होने पर, कमरे को पूर्ण चिह्नित करने के लिए दबाकर रखें। सुनिश्चित करें कि आपने सभी आवश्यक फोटो ली हैं!',
        actionHint: 'पूरा करने के लिए दबाकर रखें',
      },
      request_break: {
        title: 'ब्रेक लें',
        content: 'ब्रेक चाहिए? अनुरोध करने के लिए यह बटन टैप करें। आपके पर्यवेक्षक को इसे मंजूर करना पड़ सकता है।',
        actionHint: 'यहां ब्रेक का अनुरोध करें',
      },
      select_break_type: {
        title: 'ब्रेक प्रकार चुनें',
        content: 'ब्रेक का प्रकार चुनें: लंच ब्रेक, छोटा ब्रेक, या अन्य। प्रत्येक की अवधि अलग होती है।',
        actionHint: 'उचित ब्रेक प्रकार चुनें',
      },
      end_break: {
        title: 'ब्रेक समाप्त करें',
        content: 'जब आपका ब्रेक खत्म हो, इसे समाप्त करने और काम पर लौटने के लिए इस बटन को स्वाइप करें।',
        actionHint: 'ब्रेक समाप्त करने के लिए स्वाइप करें',
      },
      sign_out: {
        title: 'साइन आउट',
        content: 'अपनी शिफ्ट के अंत में, साइन आउट करने के लिए यहां टैप करें। पहले सुनिश्चित करें कि सभी कमरे पूरे हैं!',
        actionHint: 'शिफ्ट समाप्त होने पर साइन आउट करें',
      },
      retrieve_dnd: {
        title: 'DND कमरों की सूची',
        content: 'यह टैब परेशान न करें के रूप में चिह्नित सभी कमरे दिखाता है। जब मेहमान चिन्ह हटाते हैं, आप कमरा साफ कर सकते हैं।',
        actionHint: 'सफाई के लिए तैयार कमरे जांचें',
      },
      priority_rooms: {
        title: 'प्राथमिकता वाले कमरे',
        content: 'उच्च प्राथमिकता बैज वाले कमरे पहले साफ होने चाहिए। ये VIP मेहमान या जल्दी चेक-इन हो सकते हैं।',
        actionHint: 'पहले प्राथमिकता वाले कमरे साफ करें',
      },
      checkout_daily: {
        title: 'चेकआउट vs दैनिक सफाई',
        content: 'चेकआउट कमरों को चादर बदलाव के साथ पूर्ण सफाई चाहिए। दैनिक सफाई कब्जे वाले कमरों के लिए हल्की सफाई है।',
        actionHint: 'कमरा प्रकार बैज जांचें',
      },
      completed_tasks: {
        title: 'पूर्ण कार्य देखें',
        content: 'आज आपने जो सभी कमरे पूरे किए हैं उन्हें देखें। आप विवरण और फोटो की समीक्षा कर सकते हैं।',
        actionHint: 'अपना पूरा काम देखें',
      },
      contact_supervisor: {
        title: 'मदद लें',
        content: 'मदद चाहिए? प्रशिक्षण गाइड तक पहुंचने या अपने पर्यवेक्षक से संपर्क करने के लिए मदद बटन का उपयोग करें।',
        actionHint: 'सहायता की आवश्यकता होने पर टैप करें',
      },
    },
  },
  ro: {
    ui: {
      nextButton: 'Următorul',
      prevButton: 'Înapoi',
      skipButton: 'Sari peste',
      finishButton: 'Finalizează',
      exitButton: 'Ieși din instruire',
      stepOf: 'Pasul {current} din {total}',
      trainingComplete: 'Instruire completă!',
      congratulations: 'Felicitări! Ai completat instruirea.',
      startTraining: 'Începe instruirea',
      continueTraining: 'Continuă instruirea',
      assignTraining: 'Atribuie instruire',
      trainingAssigned: 'Instruire atribuită cu succes',
      noTrainingAssigned: 'Nicio instruire atribuită',
      selectGuide: 'Selectează un ghid',
      trainingProgress: 'Progres instruire',
      completed: 'Completat',
      inProgress: 'În desfășurare',
      notStarted: 'Neînceput',
      helpButton: 'Ajutor & Instruire',
    },
    guides: {
      'getting-started': {
        name: 'Noțiuni de bază',
        description: 'Învață elementele de bază ale aplicației',
      },
      'working-with-rooms': {
        name: 'Lucrul cu camerele',
        description: 'Cum să cureți și să gestionezi camerele atribuite',
      },
      'breaks-and-signout': {
        name: 'Pauze și deconectare',
        description: 'Gestionarea pauzelor și încheierea schimbului',
      },
      'special-situations': {
        name: 'Situații speciale',
        description: 'Gestionarea camerelor DND, întreținere și obiecte pierdute',
      },
    },
    steps: {
      welcome: {
        title: 'Bun venit la HotelCare!',
        content: 'Această instruire te va ghida prin funcțiile principale ale aplicației. Să începem!',
        actionHint: 'Apasă Următorul pentru a continua',
      },
      check_in: {
        title: 'Pontează la lucru',
        content: 'Începe ziua prin pontaj. Acest buton înregistrează prezența și deblochează camerele atribuite.',
        actionHint: 'Apasă acest buton când ajungi la lucru',
      },
      view_rooms: {
        title: 'Vezi camerele tale',
        content: 'Fila Camere arată toate camerele atribuite pentru azi. Fiecare card conține informații importante.',
        actionHint: 'Apasă pentru a vedea camerele atribuite',
      },
      room_card_info: {
        title: 'Înțelegerea cardurilor camerelor',
        content: 'Fiecare card de cameră arată: număr cameră, tip curățenie, prioritate și stare. Verde înseamnă gata de curățat!',
        actionHint: 'Uită-te la diferitele badge-uri și culori',
      },
      navigation: {
        title: 'Navigare în aplicație',
        content: 'Folosește aceste file pentru a comuta între secțiuni: camerele tale, camere DND, sarcini finalizate, etc.',
        actionHint: 'Încearcă să apeși pe diferite file',
      },
      start_room: {
        title: 'Începe curățarea camerei',
        content: 'Apasă și ține acest buton 2 secunde pentru a începe curățarea. Pornește cronometrul și notifică supervizorii.',
        actionHint: 'Apasă și ține pentru a începe',
      },
      capture_photos: {
        title: 'Fotografiază camera',
        content: 'Fă poze camerei înainte și după curățare. Este necesar pentru controlul calității.',
        actionHint: 'Apasă pentru a deschide camera',
      },
      dirty_linen: {
        title: 'Înregistrează lenjeria murdară',
        content: 'Numără și înregistrează lenjeria murdară din această cameră. Ajută la urmărirea spălătoriei.',
        actionHint: 'Apasă pentru a adăuga cantitatea de lenjerie',
      },
      mark_dnd: {
        title: 'Marchează camera ca DND',
        content: 'Dacă oaspeții au semnul Nu deranja, fotografiază semnul și marchează camera ca DND.',
        actionHint: 'Folosește când vezi semnul DND',
      },
      maintenance: {
        title: 'Raportează probleme de întreținere',
        content: 'Ai găsit ceva stricat? Raportează aici cu descriere și poză. Echipa de întreținere va fi notificată.',
        actionHint: 'Raportează problemele găsite',
      },
      lost_found: {
        title: 'Înregistrează obiecte pierdute',
        content: 'Dacă găsești obiecte lăsate de oaspeți, înregistrează-le aici cu poză și descriere.',
        actionHint: 'Înregistrează obiectele găsite',
      },
      add_notes: {
        title: 'Adaugă note',
        content: 'Adaugă note speciale despre cameră pe care supervizorii sau schimbul următor ar trebui să le știe.',
        actionHint: 'Scrie observații importante',
      },
      complete_room: {
        title: 'Finalizează camera',
        content: 'După curățare, apasă și ține pentru a marca camera ca finalizată. Asigură-te că ai făcut toate pozele necesare!',
        actionHint: 'Apasă și ține pentru a finaliza',
      },
      request_break: {
        title: 'Ia o pauză',
        content: 'Ai nevoie de pauză? Apasă acest buton pentru a solicita. Supervizorul tău poate avea nevoie să aprobe.',
        actionHint: 'Solicită pauza aici',
      },
      select_break_type: {
        title: 'Selectează tipul de pauză',
        content: 'Alege tipul de pauză: pauză de masă, pauză scurtă sau altele. Fiecare are durată diferită.',
        actionHint: 'Selectează tipul de pauză potrivit',
      },
      end_break: {
        title: 'Încheie pauza',
        content: 'Când pauza s-a terminat, glisează acest buton pentru a o încheia și a reveni la lucru.',
        actionHint: 'Glisează pentru a încheia pauza',
      },
      sign_out: {
        title: 'Deconectează-te',
        content: 'La sfârșitul schimbului, apasă aici pentru a te deconecta. Asigură-te că toate camerele sunt finalizate!',
        actionHint: 'Deconectează-te când schimbul se termină',
      },
      retrieve_dnd: {
        title: 'Lista camerelor DND',
        content: 'Această filă arată toate camerele marcate Nu deranja. Când oaspeții îndepărtează semnul, poți curăța camera.',
        actionHint: 'Verifică camerele gata de curățat',
      },
      priority_rooms: {
        title: 'Camere prioritare',
        content: 'Camerele cu badge de prioritate ridicată ar trebui curățate primele. Pot fi oaspeți VIP sau check-in-uri timpurii.',
        actionHint: 'Curăță camerele prioritare primele',
      },
      checkout_daily: {
        title: 'Checkout vs curățare zilnică',
        content: 'Camerele de checkout necesită curățare completă cu schimb de lenjerie. Curățarea zilnică este pentru camere ocupate cu curățare mai ușoară.',
        actionHint: 'Verifică badge-ul tipului de cameră',
      },
      completed_tasks: {
        title: 'Vezi munca finalizată',
        content: 'Vezi toate camerele pe care le-ai finalizat azi. Poți revizui detaliile și pozele.',
        actionHint: 'Revizuiește munca finalizată',
      },
      contact_supervisor: {
        title: 'Obține ajutor',
        content: 'Ai nevoie de ajutor? Folosește butonul de ajutor pentru a accesa ghidurile de instruire sau contactează supervizorul.',
        actionHint: 'Apasă când ai nevoie de asistență',
      },
    },
  },
  es: {
    ui: {
      nextButton: 'Siguiente',
      prevButton: 'Atrás',
      skipButton: 'Omitir',
      finishButton: 'Finalizar',
      exitButton: 'Salir del entrenamiento',
      stepOf: 'Paso {current} de {total}',
      trainingComplete: '¡Entrenamiento completo!',
      congratulations: '¡Felicitaciones! Has completado el entrenamiento.',
      startTraining: 'Iniciar entrenamiento',
      continueTraining: 'Continuar entrenamiento',
      assignTraining: 'Asignar entrenamiento',
      trainingAssigned: 'Entrenamiento asignado exitosamente',
      noTrainingAssigned: 'Sin entrenamiento asignado',
      selectGuide: 'Selecciona una guía',
      trainingProgress: 'Progreso del entrenamiento',
      completed: 'Completado',
      inProgress: 'En progreso',
      notStarted: 'No iniciado',
      helpButton: 'Ayuda y Entrenamiento',
    },
    guides: {
      'getting-started': {
        name: 'Primeros pasos',
        description: 'Aprende los conceptos básicos de la aplicación',
      },
      'working-with-rooms': {
        name: 'Trabajar con habitaciones',
        description: 'Cómo limpiar y gestionar las habitaciones asignadas',
      },
      'breaks-and-signout': {
        name: 'Descansos y cierre de sesión',
        description: 'Gestiona tus descansos y finaliza tu turno',
      },
      'special-situations': {
        name: 'Situaciones especiales',
        description: 'Manejo de habitaciones DND, mantenimiento y objetos perdidos',
      },
    },
    steps: {
      welcome: {
        title: '¡Bienvenido a HotelCare!',
        content: 'Este entrenamiento te guiará a través de las funciones principales de la aplicación. ¡Empecemos!',
        actionHint: 'Haz clic en Siguiente para continuar',
      },
      check_in: {
        title: 'Registra tu entrada',
        content: 'Comienza tu día registrándote. Este botón registra tu asistencia y desbloquea tus habitaciones asignadas.',
        actionHint: 'Toca este botón cuando llegues al trabajo',
      },
      view_rooms: {
        title: 'Ver tus habitaciones',
        content: 'La pestaña Habitaciones muestra todas las habitaciones asignadas para hoy. Cada tarjeta contiene información importante.',
        actionHint: 'Toca para ver las habitaciones asignadas',
      },
      room_card_info: {
        title: 'Entendiendo las tarjetas de habitación',
        content: 'Cada tarjeta muestra: número de habitación, tipo de limpieza, prioridad y estado actual. ¡Verde significa lista para limpiar!',
        actionHint: 'Observa las diferentes insignias y colores',
      },
      navigation: {
        title: 'Navegación de la app',
        content: 'Usa estas pestañas para cambiar entre secciones: tus habitaciones, habitaciones DND, tareas completadas, etc.',
        actionHint: 'Intenta tocar diferentes pestañas',
      },
      start_room: {
        title: 'Comenzar a limpiar una habitación',
        content: 'Mantén presionado este botón por 2 segundos para comenzar a limpiar. Esto inicia el temporizador y notifica a los supervisores.',
        actionHint: 'Mantén presionado para iniciar',
      },
      capture_photos: {
        title: 'Captura fotos de la habitación',
        content: 'Toma fotos de la habitación antes y después de limpiar. Es requerido para control de calidad.',
        actionHint: 'Toca para abrir la cámara',
      },
      dirty_linen: {
        title: 'Registrar ropa sucia',
        content: 'Cuenta y registra la ropa sucia de esta habitación. Esto ayuda con el seguimiento de lavandería.',
        actionHint: 'Toca para agregar cantidad de ropa',
      },
      mark_dnd: {
        title: 'Marcar habitación como DND',
        content: 'Si los huéspedes tienen el cartel de No Molestar, fotografía el cartel y marca la habitación como DND.',
        actionHint: 'Usa cuando veas el cartel DND',
      },
      maintenance: {
        title: 'Reportar problemas de mantenimiento',
        content: '¿Encontraste algo roto? Repórtalo aquí con descripción y foto. El equipo de mantenimiento será notificado.',
        actionHint: 'Reporta los problemas encontrados',
      },
      lost_found: {
        title: 'Registrar objetos perdidos',
        content: 'Si encuentras objetos dejados por huéspedes, regístralos aquí con foto y descripción.',
        actionHint: 'Registra los objetos encontrados',
      },
      add_notes: {
        title: 'Agregar notas',
        content: 'Agrega notas especiales sobre la habitación que los supervisores o el siguiente turno deban conocer.',
        actionHint: 'Escribe observaciones importantes',
      },
      complete_room: {
        title: 'Completar la habitación',
        content: 'Cuando termines de limpiar, mantén presionado para marcar la habitación como completa. ¡Asegúrate de haber tomado todas las fotos requeridas!',
        actionHint: 'Mantén presionado para completar',
      },
      request_break: {
        title: 'Tomar un descanso',
        content: '¿Necesitas un descanso? Toca este botón para solicitarlo. Tu supervisor puede necesitar aprobarlo.',
        actionHint: 'Solicita tu descanso aquí',
      },
      select_break_type: {
        title: 'Seleccionar tipo de descanso',
        content: 'Elige el tipo de descanso: almuerzo, descanso corto u otro. Cada uno tiene diferente duración.',
        actionHint: 'Selecciona el tipo de descanso apropiado',
      },
      end_break: {
        title: 'Finalizar descanso',
        content: 'Cuando tu descanso termine, desliza este botón para finalizarlo y volver al trabajo.',
        actionHint: 'Desliza para terminar el descanso',
      },
      sign_out: {
        title: 'Cerrar sesión',
        content: 'Al final de tu turno, toca aquí para cerrar sesión. ¡Asegúrate de que todas las habitaciones estén completadas!',
        actionHint: 'Cierra sesión cuando termine tu turno',
      },
      retrieve_dnd: {
        title: 'Lista de habitaciones DND',
        content: 'Esta pestaña muestra todas las habitaciones marcadas como No Molestar. Cuando los huéspedes quitan el cartel, puedes limpiar.',
        actionHint: 'Verifica habitaciones listas para limpiar',
      },
      priority_rooms: {
        title: 'Habitaciones prioritarias',
        content: 'Las habitaciones con insignia de alta prioridad deben limpiarse primero. Pueden ser huéspedes VIP o llegadas tempranas.',
        actionHint: 'Limpia primero las habitaciones prioritarias',
      },
      checkout_daily: {
        title: 'Checkout vs limpieza diaria',
        content: 'Las habitaciones de checkout necesitan limpieza completa con cambio de ropa. La limpieza diaria es más ligera para habitaciones ocupadas.',
        actionHint: 'Verifica la insignia del tipo de habitación',
      },
      completed_tasks: {
        title: 'Ver trabajo completado',
        content: 'Ve todas las habitaciones que completaste hoy. Puedes revisar detalles y fotos.',
        actionHint: 'Revisa tu trabajo completado',
      },
      contact_supervisor: {
        title: 'Obtener ayuda',
        content: '¿Necesitas ayuda? Usa el botón de ayuda para acceder a guías de entrenamiento o contactar a tu supervisor.',
        actionHint: 'Toca cuando necesites asistencia',
      },
    },
  },
};

export const getTrainingTranslation = (language: string) => {
  return trainingTranslations[language] || trainingTranslations.en;
};
