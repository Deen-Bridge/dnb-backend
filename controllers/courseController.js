import Course from "../models/Course.js";

// 🎓 Create a course
export const createCourse = async (req, res) => {
  try {
    const { title, description, category, image, video, price } = req.body;

    const course = new Course({
      title,
      description,
      category,
      image,
      video,
      price,
      createdBy: req.user._id, // Must be set via middleware
    });

    const saved = await course.save();
    res.status(201).json({ message: "✅ Course created", course: saved });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
