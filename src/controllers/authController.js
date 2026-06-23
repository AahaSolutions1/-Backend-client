import pool from '../config/db.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { broadcast } from '../config/websocket.js';
import { validateLimits } from '../utils/validation.js';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'cms_jwt_secret_key_2026';

export const login = async (req, res) => {
  const { email, password, rememberMe } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const [rows] = await pool.query(
      'SELECT email, role, password, name FROM users WHERE email = ?',
      [normalizedEmail]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = rows[0];

    // Plaintext password comparison as matching seed data in schema.sql
    if (user.password !== password) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: rememberMe ? '30d' : '24h' }
    );

    return res.status(200).json({
      message: 'Login successful',
      email: user.email,
      role: user.role,
      name: user.name,
      token
    });
  } catch (error) {
    console.error('Error in login controller:', error);
    return res.status(500).json({ error: 'Server error during authentication.' });
  }
};

export const getUsers = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, password, role, department, status, DATE_FORMAT(created_at, '%b %d, %Y') as created_at FROM users ORDER BY created_at DESC"
    );
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ error: 'Failed to fetch users.' });
  }
};

export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email address is required.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const [rows] = await pool.query('SELECT email FROM users WHERE email = ?', [normalizedEmail]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No user registered with this email address.' });
    }

    return res.status(200).json({
      message: `A password reset link has been sent to ${email}. Please check your inbox.`
    });
  } catch (error) {
    console.error('Error in forgotPassword controller:', error);
    return res.status(500).json({ error: 'Server error.' });
  }
};

export const signup = async (req, res) => {
  const lengthError = validateLimits(req.body);
  if (lengthError) {
    return res.status(400).json({ error: lengthError });
  }

  const { email, password, role, name, department } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  if (role && (role.toLowerCase() === 'user' || role.toLowerCase() === 'hod') && department && department.toLowerCase() === 'general') {
    return res.status(400).json({ error: 'General department is reserved for Admins only.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const assignedRole = role || 'Requester';
  if (!assignedRole || typeof assignedRole !== 'string' || !assignedRole.trim()) {
    return res.status(400).json({ error: 'Invalid role specified.' });
  }

  const assignedName = name || '';
  const assignedDept = department || '';

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const [existing] = await pool.query('SELECT email FROM users WHERE email = ?', [normalizedEmail]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email is already registered.' });
    }

    await pool.query(
      'INSERT INTO users (email, password, role, name, department) VALUES (?, ?, ?, ?, ?)',
      [normalizedEmail, password, assignedRole, assignedName, assignedDept]
    );

    broadcast({ type: 'REFRESH_USERS' });

    const token = jwt.sign(
      { email, role: assignedRole, name: assignedName },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.status(201).json({
      message: 'User registered successfully',
      email,
      role: assignedRole,
      name: assignedName,
      token
    });
  } catch (error) {
    console.error('Error in signup controller:', error);
    return res.status(500).json({ error: 'Server error during user registration.' });
  }
};

export const deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    broadcast({ type: 'REFRESH_USERS' });
    return res.status(200).json({ message: 'User deleted successfully.' });
  } catch (error) {
    console.error('Error in deleteUser controller:', error);
    return res.status(500).json({ error: 'Failed to delete user.' });
  }
};

export const updateUser = async (req, res) => {
  const lengthError = validateLimits(req.body);
  if (lengthError) {
    return res.status(400).json({ error: lengthError });
  }

  const { id } = req.params;
  const { name, email, password, role, department, status } = req.body;

  if (!email || !role) {
    return res.status(400).json({ error: 'Email and role are required.' });
  }

  if (role && (role.toLowerCase() === 'user' || role.toLowerCase() === 'hod') && department && department.toLowerCase() === 'general') {
    return res.status(400).json({ error: 'General department is reserved for Admins only.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Check if email already exists on another user
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ? AND id != ?', [normalizedEmail, id]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email is already in use by another account.' });
    }

    if (password && password.trim()) {
      await pool.query(
        'UPDATE users SET name = ?, email = ?, password = ?, role = ?, department = ?, status = ? WHERE id = ?',
        [name || '', normalizedEmail, password, role, department || '', status || 'Active', id]
      );
    } else {
      await pool.query(
        'UPDATE users SET name = ?, email = ?, role = ?, department = ?, status = ? WHERE id = ?',
        [name || '', normalizedEmail, role, department || '', status || 'Active', id]
      );
    }

    broadcast({ type: 'REFRESH_USERS' });

    return res.status(200).json({ message: 'User updated successfully.' });
  } catch (error) {
    console.error('Error in updateUser controller:', error);
    return res.status(500).json({ error: 'Failed to update user.' });
  }
};


