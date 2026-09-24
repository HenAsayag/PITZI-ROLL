<div dir="rtl">

# PITZI ROLL · פיצי רול

משחק מרוץ גולות תלת־ממדי בדפדפן בהשראת Hamsterball. הכול מקורי: אוגר בשם פיצי מתגלגל בכדור שקוף נגד השעון. המשחק חלק מ־HEN'S ARCADE.

## מה בחבילה
| תיקייה | תוכן |
|---|---|
| `MASTER_PROMPT.md` | הפרומפט לבנייה ב־one-shot. מדביקים ל־Claude יחד עם התיקייה |
| `docs/research.md` | מחקר על המשחק המקורי וההחלטות שנגזרו ממנו |
| `levels/levels.json` | 8 מרוצים כשרשרת סגמנטים, כולל זמנים ומדליות |
| `levels/previews/` | מפת מבט־על ופרופיל גובה לכל מרוץ (`_overview.png` מציג את כולם) |
| `assets/textures/` | 32 טקסטורות: רצפות ל־7 ערכות נושא, קירות, שמיים, פדים ומשטחים |
| `assets/sprites/` | חלקיקים: כוכבי סחרחורת, ניצוץ, אבק, רסיס זכוכית, צל |
| `assets/ui/` | לוגו, פיצי ב־3 הבעות, פיצי בכדור, favicon (SVG + PNG) |
| `assets/icons/` | 17 אייקונים ומדליות (SVG + PNG) |
| `assets/sfx/` | 22 אפקטים + לופ מוזיקה (WAV) |
| `assets/fonts/` | Rubik עם תמיכה בעברית (רישיון OFL) |
| `tools/` | הסקריפטים שיצרו את הכול. אפשר להריץ שוב ולשנות |

## איך משתמשים
1. פותחים שיחה חדשה עם Claude, מעלים את התיקייה (או את `levels.json` וצילום של `assets/`) ומדביקים את `MASTER_PROMPT.md`.
2. שומרים את `index.html` ואת `game.js` שחוזרים ליד `assets/` ו־`levels/`.
3. מריצים שרת סטטי: `npx serve .` ופותחים בדפדפן.

## עריכת מסלולים
עורכים את `LEVELS` ב־`tools/make_levels.py` ומריצים `python3 tools/make_levels.py`. הסקריפט מחשב את כל התנוחות, בודק שהמסלול חוקי (יש התחלה וקו סיום, יש צ'קפוינט, כל פער אפשר לחצות, אין חפיפות) ומייצר תצוגות מקדימות מחדש.

</div>

<div dir="rtl">

## לשחק מהטלפון (GitHub Pages)
1. ב־GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, בוחרים `main` ו־`/ (root)` ולוחצים **Save**.
2. אחרי דקה־שתיים המשחק זמין בכתובת: **https://henasayag.github.io/PITZI-ROLL/**
3. באנדרואיד אפשר ללחוץ על "מסך מלא ויאללה" במסך הפתיחה. באייפון אין מסך מלא בדפדפן, אז לוחצים "המשך". כדי לשחק במסך מלא באייפון: **שתף ← הוספה למסך הבית**, ופותחים את המשחק מהאייקון.

## טבלת שיאים משותפת (Firebase, חינם)
כל עוד `leaderboard-config.js` ריק, המשחק עובד בלי אינטרנט, בלי הרשמה ובלי טבלה משותפת. כדי להפעיל:
1. נכנסים ל־https://console.firebase.google.com ויוצרים פרויקט (אפשר בלי Google Analytics).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable** (רק האפשרות הראשונה).
3. **Build → Firestore Database → Create database** (production mode, אזור קרוב, למשל `eur3`).
4. בלשונית **Rules** של Firestore מדביקים את התוכן של `firestore.rules` מהריפו ולוחצים **Publish**.
5. **Project settings → General → Your apps → `</>` (Web)**. רושמים אפליקציה (בלי Hosting) ומעתיקים את האובייקט `firebaseConfig`.
6. מדביקים אותו ב־`leaderboard-config.js` במקום `null`, עושים commit ו־push.

מה השחקנים מקבלים: במסך הפתיחה נרשמים עם כינוי וסיסמה (חובה כשהטבלה פעילה). כל סיום מרוץ שולח את הזמן הכי טוב שלהם לטבלה של אותו שלב, וטורניר שלם שולח ניקוד לטבלה לפי רמת קושי. בתפריט יש כפתור **טבלת שיאים** עם לשונית לכל אחד מ־8 המרוצים ולשונית 🏆 לטורניר. ריצות במצב מראה ודילוגי מפתח (Shift+N) לא נספרים.

</div>
