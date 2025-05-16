import Course from "../models/Course.js";
import cloudinary from "../utils/cloudinary.js";

// Helper function to upload buffer
const uploadToCloudinary = (fileBuffer, folder, resourceType = "image") => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(fileBuffer);
  });
};

export const createCourse = async (req, res) => {
  try {
    const { title, description, category, price, createdBy } = req.body;

    let imageUrl = null;
    let videoUrl = null;

    if (req.files?.image?.[0]) {
      const imageBuffer = req.files.image[0].buffer;
      const imageResult = await uploadToCloudinary(
        imageBuffer,
        "courses",
        "image"
      );
      imageUrl = imageResult.secure_url;
    }

    if (req.files?.video?.[0]) {
      const videoBuffer = req.files.video[0].buffer;
      const videoResult = await uploadToCloudinary(
        videoBuffer,
        "courses",
        "video"
      );
      videoUrl = videoResult.secure_url;
    }

    const course = await Course.create({
      title,
      description,
      category,
      price,
      createdBy :req.user._id,
      image: imageUrl,
      video: videoUrl,
    });

    res.status(201).json({ success: true, course });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};




// 📚 Get all courses
export const getCourses = async (_req, res) => {
  try {
    const courses = await Course.find().populate("createdBy", "name email");
    res.status(200).json(courses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 📘 Get a single course
export const getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: "Course not found" });

    res.status(200).json(course);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 📥 Enroll a user in a course
export const enrollInCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) return res.status(404).json({ error: "Course not found" });

    // Check if already enrolled
    if (course.enrolledUsers.includes(req.user._id)) {
      return res
        .status(400)
        .json({ message: "You already enrolled in this course" });
    }

    course.enrolledUsers.push(req.user._id);
    await course.save();

    res.status(200).json({ message: "✅ Enrolled successfully", course });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
