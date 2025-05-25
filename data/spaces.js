// Sample data for spaces
import mongoose from "mongoose";

const spaces = [
  {
    title: "Qur'an Reflection Circle",
    description: "A live space for group reflection on selected verses of the Qur'an. Open to all levels.",
    category: "Qur'an",
    thumbnail: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80",
    status: "live",
    startTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    duration: 60,
    host: {
      name: "Ustadh Ahmad",
      image: "https://randomuser.me/api/portraits/men/32.jpg"
    },
    price: 0,
    authorBio: "Ustadh Ahmad is a renowned Qur'an teacher with 15+ years of experience.",
    authorImage: "https://randomuser.me/api/portraits/men/32.jpg",
    monthlyReads: 120,
    downloads: 45,
    rating: 4.8,
    id: "space1"
  },
  {
    title: "Sisters' Fiqh Q&A",
    description: "A safe space for sisters to ask questions about Fiqh and daily practice.",
    category: "Fiqh",
    thumbnail: "https://images.unsplash.com/photo-1464983953574-0892a716854b?auto=format&fit=crop&w=800&q=80",
    status: "upcoming",
    startTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
    duration: 90,
    host: {
      name: "Ustadha Maryam",
      image: "https://randomuser.me/api/portraits/women/44.jpg"
    },
    price: 0,
    authorBio: "Ustadha Maryam specializes in women's Fiqh and community education.",
    authorImage: "https://randomuser.me/api/portraits/women/44.jpg",
    monthlyReads: 80,
    downloads: 20,
    rating: 4.6,
    id: "space2"
  },
  {
    title: "Arabic Conversation Practice",
    description: "Practice your spoken Arabic in a friendly, supportive environment.",
    category: "Language",
    thumbnail: "https://images.unsplash.com/photo-1519125323398-675f0ddb6308?auto=format&fit=crop&w=800&q=80",
    status: "live",
    startTime: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes from now
    duration: 45,
    host: {
      name: "Dr. Kareem",
      image: "https://randomuser.me/api/portraits/men/45.jpg"
    },
    price: 10,
    authorBio: "Dr. Kareem is a native Arabic speaker and linguist.",
    authorImage: "https://randomuser.me/api/portraits/men/45.jpg",
    monthlyReads: 60,
    downloads: 10,
    rating: 4.2,
    id: "space3"
  }
];

export default spaces;
