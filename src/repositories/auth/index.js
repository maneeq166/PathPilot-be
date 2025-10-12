const { env } = require("../../config/env");
const { User } = require("../../models/userModel");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

exports.createUser = async (username, password, email) => {
  return await User.create({ username, password, email });
};

exports.verifyToken = (token) => {
  return jwt.verify(token, env.JWT_SECRET);
};

exports.createToken = (id,username,email) =>{
    return jwt.sign({id,username,email},env.JWT_SECRET);
}
/**
 * Check if a user exists by email or phoneNumber
 */
exports.checkUser = async (email) => {
  return await User.find({ email });
};

/**
 * Update user by ID
 */
exports.updateUser = async (_id, updatedFields) => {
  return await User.findByIdAndUpdate(
    _id,
    { $set: updatedFields },
    { new: true }
  ).select("-password");
};

/**
 * Delete user by ID
 */
exports.deleteUser = async (_id) => {
  return await User.findByIdAndDelete(_id).select("-password");
};

exports.checkPassword = async (password, hashedPass) => {
  return await bcrypt.compare(password, hashedPass);
};
