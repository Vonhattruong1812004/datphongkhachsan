import fs from "node:fs/promises";
import path from "node:path";

export type NewsReactionKey = "like" | "want" | "visited" | "hot";

export interface NewsComment {
  id: string;
  author: string;
  message: string;
  createdAt: string;
}

export interface DestinationNewsArticle {
  slug: string;
  title: string;
  location: string;
  category: string;
  summary: string;
  body: string[];
  imageUrl: string;
  imageAlt: string;
  sourceName: string;
  sourceUrl: string;
  readingMinutes: number;
  tags: string[];
  updatedAt: string;
  viralScore: number;
  reactions: Record<NewsReactionKey, number>;
  comments: NewsComment[];
}

interface StoredNewsInteractions {
  articles: Record<string, {
    reactions?: Partial<Record<NewsReactionKey, number>>;
    comments?: NewsComment[];
  }>;
}

const REACTION_LABELS: Record<NewsReactionKey, string> = {
  like: "Thích",
  want: "Muốn đi",
  visited: "Đã đi",
  hot: "Đang hot"
};

const SEED_ARTICLES: DestinationNewsArticle[] = [
  {
    slug: "can-tho-cho-noi-cai-rang",
    title: "Chợ nổi Cái Răng lại lên mood miền Tây: đi sớm, ăn sáng trên ghe và ngắm sông thức dậy",
    location: "Cần Thơ",
    category: "Điểm đến viral",
    summary: "Một lịch trình sáng sớm ở Cần Thơ đang được khách trẻ nhắc nhiều: ra bến trước bình minh, xem ghe hàng tụ lại và ăn tô bún nóng ngay trên sông.",
    body: [
      "Chợ nổi Cái Răng vẫn là biểu tượng dễ nhận ra nhất của Cần Thơ. Trải nghiệm đáng giá nhất nằm ở khung giờ rất sớm, khi các ghe trái cây, cà phê, bún nước và hàng nông sản bắt đầu nối nhau trên mặt sông.",
      "Điểm khiến nơi này dễ viral là cảm giác rất đời: tiếng máy ghe, tiếng mời hàng, màu trái cây treo trên cây bẹo và nhịp sinh hoạt mà khách thành phố hiếm khi gặp trong kỳ nghỉ ngắn.",
      "Nếu đi theo lịch nghỉ dưỡng, khách nên đặt chuyến sáng sớm, về lại khách sạn trước trưa rồi dành buổi chiều cho miệt vườn hoặc bến Ninh Kiều."
    ],
    imageUrl: "/uploads/destinations/can-tho-cai-rang.jpg",
    imageAlt: "Chợ nổi Cái Răng tại Cần Thơ",
    sourceName: "Vietnam Tourism",
    sourceUrl: "https://vietnam.travel/things-to-do/can-tho-glimpse-river-and-garden",
    readingMinutes: 3,
    tags: ["chợ nổi", "miền Tây", "ăn sáng", "sông nước"],
    updatedAt: "2026-07-26",
    viralScore: 98,
    reactions: { like: 126, want: 84, visited: 39, hot: 57 },
    comments: [
      {
        id: "seed-cai-rang-1",
        author: "Minh Anh",
        message: "Đi tầm 5h30 sáng là đẹp nhất, trời mát và ảnh lên màu rất ổn.",
        createdAt: "2026-07-25T07:20:00.000Z"
      },
      {
        id: "seed-cai-rang-2",
        author: "Gia Bảo",
        message: "Nên đặt thuyền trước, cuối tuần khá đông khách.",
        createdAt: "2026-07-25T10:40:00.000Z"
      }
    ]
  },
  {
    slug: "hoi-an-dem-long-den",
    title: "Hội An vẫn giữ sức hút: phố cổ, đèn lồng và những góc ảnh không cần filter",
    location: "Hội An",
    category: "Gợi ý cuối tuần",
    summary: "Hội An hợp với kiểu đi chậm: ban ngày cà phê, chiều dạo phố, tối lên đèn và chọn một bữa ăn địa phương thật gọn.",
    body: [
      "Hội An không mới, nhưng vẫn là điểm đến có sức lan truyền mạnh nhờ không khí phố cổ và ánh đèn vào buổi tối. Khách lần đầu nên dành thời gian đi bộ, ghé các ngõ nhỏ và tránh nhồi quá nhiều lịch trình trong một ngày.",
      "Các trải nghiệm dễ kết hợp gồm thưởng thức cao lầu, đi thuyền trên sông Hoài, xem phố lên đèn và chọn homestay/resort yên tĩnh bên ngoài lõi phố cổ.",
      "Nếu muốn ảnh đẹp, thời điểm chiều muộn đến đầu tối thường dễ chụp hơn giữa trưa vì ánh sáng mềm và phố bắt đầu có không khí."
    ],
    imageUrl: "/uploads/destinations/hoi-an.jpg",
    imageAlt: "Phố cổ Hội An",
    sourceName: "Vietnam Tourism",
    sourceUrl: "https://vietnam.travel/places-to-go/central-vietnam/hoi-an",
    readingMinutes: 4,
    tags: ["phố cổ", "đèn lồng", "ẩm thực", "check-in"],
    updatedAt: "2026-07-26",
    viralScore: 94,
    reactions: { like: 112, want: 79, visited: 61, hot: 42 },
    comments: [
      {
        id: "seed-hoi-an-1",
        author: "Thanh Trúc",
        message: "Tối Hội An đẹp nhưng đông, đi sớm hơn một chút sẽ dễ thở hơn.",
        createdAt: "2026-07-24T15:15:00.000Z"
      }
    ]
  },
  {
    slug: "da-nang-ba-na-hills",
    title: "Đà Nẵng - Bà Nà Hills: combo mát, nhiều góc chụp và hợp nhóm gia đình",
    location: "Đà Nẵng",
    category: "Trend du lịch",
    summary: "Bà Nà Hills vẫn là lịch trình dễ chốt cho nhóm đông vì có cáp treo, khu vui chơi, kiến trúc châu Âu và khí hậu mát hơn trung tâm thành phố.",
    body: [
      "Từ trung tâm Đà Nẵng, du khách có thể dành gần trọn một ngày cho Bà Nà Hills. Điểm mạnh của lịch trình này là nhiều hoạt động trong cùng khu vực, phù hợp cả khách gia đình lẫn nhóm bạn muốn có ảnh đẹp.",
      "Cầu Vàng, các khu vườn, quảng trường và cáp treo là những điểm thường xuất hiện trong ảnh check-in. Nên đi sớm để đỡ đông và chủ động hơn khi thời tiết thay đổi.",
      "Khi kết hợp nghỉ dưỡng, khách có thể ở biển Mỹ Khê hoặc trung tâm Đà Nẵng, sau đó dành một ngày lên núi và một ngày cho ẩm thực địa phương."
    ],
    imageUrl: "/uploads/destinations/da-nang-ba-na.jpg",
    imageAlt: "Bà Nà Hills Đà Nẵng",
    sourceName: "Vietnam Tourism",
    sourceUrl: "https://vietnam.travel/things-to-do/10-ways-spend-day-ba-na-hills-danang",
    readingMinutes: 3,
    tags: ["Đà Nẵng", "Bà Nà Hills", "gia đình", "check-in"],
    updatedAt: "2026-07-26",
    viralScore: 91,
    reactions: { like: 96, want: 70, visited: 44, hot: 36 },
    comments: [
      {
        id: "seed-da-nang-1",
        author: "Quốc Huy",
        message: "Đi ngày thường ổn hơn, cuối tuần xếp hàng cáp treo hơi lâu.",
        createdAt: "2026-07-23T09:05:00.000Z"
      }
    ]
  },
  {
    slug: "phu-quoc-bien-dao-nghi-duong",
    title: "Phú Quốc vào mùa nghỉ dưỡng: biển, sunset và lịch trình ít phải di chuyển",
    location: "Phú Quốc",
    category: "Biển đảo",
    summary: "Phú Quốc hợp với khách muốn nghỉ thật sự: chọn resort tốt, dành nhiều thời gian cho biển, sunset bar và các trải nghiệm gần chỗ ở.",
    body: [
      "Phú Quốc có lợi thế lớn cho kỳ nghỉ ngắn vì nhiều lựa chọn lưu trú sát biển, dễ kết hợp nghỉ dưỡng với ẩm thực và các điểm ngắm hoàng hôn.",
      "Những lịch trình đang được quan tâm thường xoay quanh tắm biển, ngắm sunset, chợ đêm, tour đảo hoặc một buổi spa nhẹ trong resort.",
      "Với khách đi gia đình, nên chọn khu lưu trú có hồ bơi, bữa sáng và dịch vụ đưa đón để giảm thời gian di chuyển trong ngày đầu."
    ],
    imageUrl: "/uploads/destinations/phu-quoc.jpg",
    imageAlt: "Bãi biển Phú Quốc",
    sourceName: "Vietnam Tourism",
    sourceUrl: "https://vietnam.travel/places-to-go/southern-vietnam/phu-quoc",
    readingMinutes: 3,
    tags: ["biển đảo", "sunset", "resort", "gia đình"],
    updatedAt: "2026-07-26",
    viralScore: 88,
    reactions: { like: 89, want: 74, visited: 32, hot: 29 },
    comments: [
      {
        id: "seed-phu-quoc-1",
        author: "Hoàng Vy",
        message: "Sunset ở Phú Quốc rất đáng đi, nên canh trời trước khi đặt lịch.",
        createdAt: "2026-07-22T13:50:00.000Z"
      }
    ]
  }
];

export class NewsService {
  readonly reactionLabels = REACTION_LABELS;
  private readonly dataPath = path.resolve(process.cwd(), "data/news-interactions.json");

  async listArticles(): Promise<DestinationNewsArticle[]> {
    const interactions = await this.readInteractions();
    return SEED_ARTICLES.map((article) => this.mergeInteractions(article, interactions)).sort((a, b) => b.viralScore - a.viralScore);
  }

  async getArticle(slug: string): Promise<DestinationNewsArticle | null> {
    const article = SEED_ARTICLES.find((item) => item.slug === slug);
    if (!article) {
      return null;
    }

    return this.mergeInteractions(article, await this.readInteractions());
  }

  async getFeaturedArticles(limit = 3) {
    return (await this.listArticles()).slice(0, limit);
  }

  async addReaction(slug: string, reaction: string) {
    const normalized = this.normalizeReaction(reaction);
    if (!normalized || !SEED_ARTICLES.some((article) => article.slug === slug)) {
      return;
    }

    const interactions = await this.readInteractions();
    const articleState = interactions.articles[slug] || {};
    const reactions = articleState.reactions || {};
    reactions[normalized] = Number(reactions[normalized] || 0) + 1;
    interactions.articles[slug] = { ...articleState, reactions };
    await this.writeInteractions(interactions);
  }

  async addComment(slug: string, input: { author?: string; message?: string }) {
    if (!SEED_ARTICLES.some((article) => article.slug === slug)) {
      return;
    }

    const message = this.cleanText(input.message || "", 500);
    if (!message) {
      return;
    }

    const author = this.cleanText(input.author || "Khách du lịch", 80) || "Khách du lịch";
    const interactions = await this.readInteractions();
    const articleState = interactions.articles[slug] || {};
    const comments = articleState.comments || [];
    comments.unshift({
      id: `cmt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      author,
      message,
      createdAt: new Date().toISOString()
    });
    interactions.articles[slug] = { ...articleState, comments: comments.slice(0, 50) };
    await this.writeInteractions(interactions);
  }

  private mergeInteractions(article: DestinationNewsArticle, interactions: StoredNewsInteractions): DestinationNewsArticle {
    const stored = interactions.articles[article.slug] || {};
    const reactions = { ...article.reactions };

    for (const key of Object.keys(REACTION_LABELS) as NewsReactionKey[]) {
      reactions[key] += Number(stored.reactions?.[key] || 0);
    }

    const comments = [...(stored.comments || []), ...article.comments].slice(0, 80);

    return {
      ...article,
      reactions,
      comments
    };
  }

  private normalizeReaction(value: string): NewsReactionKey | null {
    return (Object.keys(REACTION_LABELS) as NewsReactionKey[]).find((key) => key === value) || null;
  }

  private async readInteractions(): Promise<StoredNewsInteractions> {
    try {
      const raw = await fs.readFile(this.dataPath, "utf8");
      const parsed = JSON.parse(raw) as StoredNewsInteractions;
      return parsed && typeof parsed === "object" && parsed.articles ? parsed : { articles: {} };
    } catch (_error) {
      return { articles: {} };
    }
  }

  private async writeInteractions(data: StoredNewsInteractions) {
    await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
    await fs.writeFile(this.dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  private cleanText(value: string, maxLength: number) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }
}
