import data from "@emoji-mart/data";
import { Picker } from "emoji-mart";
import { DomContents } from "grainjs";

interface EmojiPickerOptions {
  onEmojiSelect: (emoji: any) => void;
  theme?: "auto" | "dark" | "light";
}

export async function buildEmojiPicker({
  onEmojiSelect,
  theme
}: EmojiPickerOptions) {
  return new Picker({
    data,
    onEmojiSelect,
    theme,
    categories: [
      "suggested",
      "frequent",
      "people",
      "nature",
      "foods",
      "activity",
      "places",
      "objects",
      "symbols",
      "flags",
    ],
    custom: [
      {
        id: "suggested",
        name: "Suggested",
        emojis: [
          {
            id: "clipboard",
            name: "Clipboard",
            skins: [
              {
                native: "📋",
                unified: "1f4cb",
              },
            ],
            keywords: ["stationery", "documents"],
            shortcodes: ":clipboard:",
          },
          {
            id: "busts_in_silhouette",
            name: "Busts in Silhouette",
            skins: [
              {
                native: "👥",
                unified: "1f465",
              },
            ],
            keywords: ["user", "person", "human", "group", "team"],
            shortcodes: ":busts_in_silhouette:",
          },
          {
            id: "chart_with_upwards_trend",
            name: "Chart Increasing",
            skins: [
              {
                native: "📈",
                unified: "1f4c8",
              },
            ],
            keywords: [
              "with",
              "upwards",
              "trend",
              "graph",
              "presentation",
              "stats",
              "recovery",
              "business",
              "economics",
              "money",
              "sales",
              "good",
              "success",
            ],
            shortcodes: ":chart_with_upwards_trend:",
          },
          {
            id: "dollar",
            name: "Dollar Banknote",
            skins: [
              {
                native: "💵",
                unified: "1f4b5",
              },
            ],
            keywords: ["money", "sales", "bill", "currency"],
            shortcodes: ":dollar:",
          },
          {
            id: "blue_book",
            name: "Blue Book",
            skins: [
              {
                native: "📘",
                unified: "1f4d8",
              },
            ],
            keywords: ["read", "library", "knowledge", "learn", "study"],
            shortcodes: ":blue_book:",
          },
          {
            id: "school",
            name: "School",
            skins: [
              {
                native: "🏫",
                unified: "1f3eb",
              },
            ],
            keywords: ["building", "student", "education", "learn", "teach"],
            shortcodes: ":school:",
          },
          {
            id: "spiral_calendar_pad",
            name: "Spiral Calendar",
            skins: [
              {
                native: "🗓️",
                unified: "1f5d3-fe0f",
              },
            ],
            keywords: ["pad", "date", "schedule", "planning"],
            shortcodes: ":spiral_calendar_pad:",
          },
          {
            id: "white_check_mark",
            name: "Check Mark Button",
            skins: [
              {
                native: "✅",
                unified: "2705",
              },
            ],
            keywords: [
              "white",
              "green",
              "square",
              "ok",
              "agree",
              "vote",
              "election",
              "answer",
              "tick",
            ],
            shortcodes: ":white_check_mark:",
          },
          {
            id: "email",
            name: "Envelope",
            skins: [
              {
                native: "✉️",
                unified: "2709-fe0f",
              },
            ],
            keywords: ["email", "letter", "postal", "inbox", "communication"],
            shortcodes: ":email:",
            aliases: ["envelope"],
          },
          {
            id: "lock",
            name: "Lock",
            skins: [
              {
                native: "🔒",
                unified: "1f512",
              },
            ],
            keywords: ["locked", "security", "password", "padlock"],
            shortcodes: ":lock:",
          },
          {
            id: "unlock",
            name: "Unlocked",
            skins: [
              {
                native: "🔓",
                unified: "1f513",
              },
            ],

            keywords: ["unlock", "privacy", "security"],
            shortcodes: ":unlock:",
          },
          {
            id: "ring",
            name: "Ring",
            skins: [
              {
                native: "💍",
                unified: "1f48d",
              },
            ],

            keywords: [
              "wedding",
              "propose",
              "marriage",
              "valentines",
              "diamond",
              "fashion",
              "jewelry",
              "gem",
              "engagement",
            ],
            shortcodes: ":ring:",
          },
          {
            id: "key",
            name: "Key",
            skins: [
              {
                native: "🔑",
                unified: "1f511",
              },
            ],

            keywords: ["lock", "door", "password"],
            shortcodes: ":key:",
          },
          {
            id: "beach_with_umbrella",
            name: "Beach with Umbrella",
            skins: [
              {
                native: "🏖️",
                unified: "1f3d6-fe0f",
              },
            ],

            keywords: ["weather", "summer", "sunny", "sand", "mojito"],
            shortcodes: ":beach_with_umbrella:",
          },
          {
            id: "hamburger",
            name: "Hamburger",
            skins: [
              {
                native: "🍔",
                unified: "1f354",
              },
            ],

            keywords: [
              "meat",
              "fast",
              "food",
              "beef",
              "cheeseburger",
              "mcdonalds",
              "burger",
              "king",
            ],
            shortcodes: ":hamburger:",
          },
          {
            id: "birthday",
            name: "Birthday Cake",
            skins: [
              {
                native: "🎂",
                unified: "1f382",
              },
            ],

            keywords: ["food", "dessert"],
            shortcodes: ":birthday:",
          },
          {
            id: "football",
            name: "American Football",
            skins: [
              {
                native: "🏈",
                unified: "1f3c8",
              },
            ],

            keywords: ["sports", "balls", "NFL"],
            shortcodes: ":football:",
          },
          {
            id: "soccer",
            name: "Soccer Ball",
            skins: [
              {
                native: "⚽",
                unified: "26bd",
              },
            ],

            keywords: ["sports", "football"],
            shortcodes: ":soccer:",
          },
          {
            id: "baseball",
            name: "Baseball",
            skins: [
              {
                native: "⚾",
                unified: "26be",
              },
            ],

            keywords: ["sports", "balls"],
            shortcodes: ":baseball:",
          },
          {
            id: "earth_americas",
            name: "Earth Globe Americas",
            skins: [
              {
                native: "🌎",
                unified: "1f30e",
              },
            ],

            keywords: ["showing", "world", "USA", "international"],
            shortcodes: ":earth_americas:",
          },
          {
            id: "office",
            name: "Office Building",
            skins: [
              {
                native: "🏢",
                unified: "1f3e2",
              },
            ],

            keywords: ["bureau", "work"],
            shortcodes: ":office:",
          },
          {
            id: "airplane",
            name: "Airplane",
            skins: [
              {
                native: "✈️",
                unified: "2708-fe0f",
              },
            ],

            keywords: ["vehicle", "transportation", "flight", "fly"],
            shortcodes: ":airplane:",
          },
          {
            id: "blossom",
            name: "Blossom",
            skins: [
              {
                native: "🌼",
                unified: "1f33c",
              },
            ],

            keywords: ["nature", "flowers", "yellow"],
            shortcodes: ":blossom:",
          },
          {
            id: "four_leaf_clover",
            name: "Four Leaf Clover",
            skins: [
              {
                native: "🍀",
                unified: "1f340",
              },
            ],

            keywords: ["vegetable", "plant", "nature", "lucky", "irish"],
            shortcodes: ":four_leaf_clover:",
          },
          {
            id: "butterfly",
            name: "Butterfly",
            skins: [
              {
                native: "🦋",
                unified: "1f98b",
              },
            ],

            keywords: ["animal", "insect", "nature", "caterpillar"],
            shortcodes: ":butterfly:",
          },
          {
            id: "apple",
            name: "Red Apple",
            skins: [
              {
                native: "🍎",
                unified: "1f34e",
              },
            ],

            keywords: ["fruit", "mac", "school"],
            shortcodes: ":apple:",
          },
          {
            id: "snowflake",
            name: "Snowflake",
            skins: [
              {
                native: "❄️",
                unified: "2744-fe0f",
              },
            ],

            keywords: [
              "winter",
              "season",
              "cold",
              "weather",
              "christmas",
              "xmas",
            ],
            shortcodes: ":snowflake:",
          },
          {
            id: "medical_symbol",
            name: "Medical Symbol",
            skins: [
              {
                native: "⚕️",
                unified: "2695-fe0f",
              },
            ],

            keywords: ["staff", "of", "aesculapius", "health", "hospital"],
            shortcodes: ":medical_symbol:",
            aliases: ["staff_of_aesculapius"],
          },
          {
            id: "hospital",
            name: "Hospital",
            skins: [
              {
                native: "🏥",
                unified: "1f3e5",
              },
            ],

            keywords: ["building", "health", "surgery", "doctor"],
            shortcodes: ":hospital:",
          },
          {
            id: "test_tube",
            name: "Test Tube",
            skins: [
              {
                native: "🧪",
                unified: "1f9ea",
              },
            ],

            keywords: ["chemistry", "experiment", "lab", "science"],
            shortcodes: ":test_tube:",
          },
          {
            id: "microscope",
            name: "Microscope",
            skins: [
              {
                native: "🔬",
                unified: "1f52c",
              },
            ],

            keywords: [
              "laboratory",
              "experiment",
              "zoomin",
              "science",
              "study",
            ],
            shortcodes: ":microscope:",
          },
          {
            id: "construction_worker",
            name: "Construction Worker",
            skins: [
              {
                native: "👷",
                unified: "1f477",
              },
            ],

            keywords: ["labor", "build"],
            shortcodes: ":construction_worker:",
            skin: 1,
          },
          {
            id: "building_construction",
            name: "Building Construction",
            skins: [
              {
                native: "🏗️",
                unified: "1f3d7-fe0f",
              },
            ],

            keywords: ["wip", "working", "progress"],
            shortcodes: ":building_construction:",
          },
          {
            id: "office_worker",
            name: "Office Worker",
            skins: [
              {
                native: "🧑‍💼",
                unified: "1f9d1-200d-1f4bc",
              },
            ],

            keywords: ["business"],
            shortcodes: ":office_worker:",
            skin: 1,
          },
          {
            id: "handshake",
            name: "Handshake",
            skins: [
              {
                native: "🤝",
                unified: "1f91d",
              },
            ],
            keywords: ["agreement", "shake"],
            shortcodes: ":handshake:",
            skin: 1,
          },
          {
            id: "briefcase",
            name: "Briefcase",
            skins: [
              {
                native: "💼",
                unified: "1f4bc",
              },
            ],
            keywords: [
              "business",
              "documents",
              "work",
              "law",
              "legal",
              "job",
              "career",
            ],
            shortcodes: ":briefcase:",
          },
          {
            id: "classical_building",
            name: "Classical Building",
            skins: [
              {
                native: "🏛️",
                unified: "1f3db-fe0f",
              },
            ],
            keywords: ["art", "culture", "history"],
            shortcodes: ":classical_building:",
          },
          {
            id: "scales",
            name: "Balance Scale",
            skins: [
              {
                native: "⚖️",
                unified: "2696-fe0f",
              },
            ],

            keywords: ["scales", "law", "fairness", "weight"],
            shortcodes: ":scales:",
          },
          {
            id: "house",
            name: "House",
            skins: [
              {
                native: "🏠",
                unified: "1f3e0",
              },
            ],
            keywords: ["building", "home"],
            shortcodes: ":house:",
          },
          {
            id: "mortar_board",
            name: "Graduation Cap",
            skins: [
              {
                native: "🎓",
                unified: "1f393",
              },
            ],
            keywords: [
              "mortar",
              "board",
              "school",
              "college",
              "degree",
              "university",
              "hat",
              "legal",
              "learn",
              "education",
            ],
            shortcodes: ":mortar_board:",
          },
          {
            id: "books",
            name: "Books",
            skins: [
              {
                native: "📚",
                unified: "1f4da",
              },
            ],
            keywords: ["literature", "library", "study"],
            shortcodes: ":books:",
          },
        ],
      },
    ],
  }) as unknown as DomContents;
}
