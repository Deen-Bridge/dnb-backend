import mongoose from 'mongoose';

// Pure function for initial slug generation
export function slugify(text) {
  return text
    .toString()
    .normalize('NFD')                   // split an accented letter in the base letter and the accent
    .replace(/[\u0300-\u036f]/g, '')   // remove all previously split accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 ]/g, '')        // remove all chars not letters, numbers and spaces (to be replaced)
    .replace(/\s+/g, '-');             // replace spaces with -
}

export async function generateUniqueSlug(name, existingSlugsChecker) {
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let counter = 2;

  while (await existingSlugsChecker(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      unique: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      index: true,
    },
    description: {
      type: String,
    },
    icon: {
      type: String,
      match: [/^https?:\/\//, 'Icon must be a valid URL'],
    },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

categorySchema.index({ parent: 1, order: 1 });

categorySchema.pre('save', async function (next) {
  if (this.isModified('name') || !this.slug) {
    if (!this.slug) {
      this.slug = await generateUniqueSlug(this.name, async (candidateSlug) => {
        // If we found a document with the same slug that isn't the current one
        const query = { slug: candidateSlug };
        if (this._id) {
          query._id = { $ne: this._id };
        }
        const existing = await mongoose.models.Category.findOne(query).select('_id').lean();
        return !!existing;
      });
    }
  }
  next();
});

const Category = mongoose.models.Category || mongoose.model('Category', categorySchema);

export default Category;
