import mongoose from 'mongoose';

const TeacherSchema = new mongoose.Schema({
  collectionCode: { type: String, index: true },
  teacherId: { type: String, index: true },  // 교사고유번호
  name: String
}, { timestamps: true });

TeacherSchema.index({ collectionCode: 1, teacherId: 1 }, { unique: true });

export default mongoose.model('Teacher', TeacherSchema);
