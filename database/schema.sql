-- -------------------------------------------------------------
-- Database Schema for Change Management System (CMS.io)
-- MySQL
-- -------------------------------------------------------------
 
SET FOREIGN_KEY_CHECKS = 0;
 
-- Drop tables if they already exist (for clean initialization)
DROP TABLE IF EXISTS hod_approvals;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS effectiveness_attachments;
DROP TABLE IF EXISTS effectiveness_logs;
DROP TABLE IF EXISTS l3_approvals;
DROP TABLE IF EXISTS l2_attachments;
DROP TABLE IF EXISTS l2_validation_logs;
DROP TABLE IF EXISTS l1_attachments;
DROP TABLE IF EXISTS l1_requests;
DROP TABLE IF EXISTS change_requests;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS processes;
DROP TABLE IF EXISTS machines;
 
-- Roles Table
CREATE TABLE roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL
);
 
-- Departments Table
CREATE TABLE departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL
);
 
-- Processes Table
CREATE TABLE processes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL
);
 
-- Machines Table
CREATE TABLE machines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL
);
 
-- 1. Users Table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL DEFAULT '',
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL, -- In production, this should be a hashed password (e.g. bcrypt)
    role VARCHAR(50) NOT NULL,
    department VARCHAR(255) NOT NULL DEFAULT '',
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
 
-- Create index on email for fast authentication lookups
CREATE INDEX idx_users_email ON users(email);
 
-- 2. Change Requests Table
CREATE TABLE change_requests (
    id VARCHAR(50) PRIMARY KEY, -- e.g. 'CHG-8902'
    title VARCHAR(255) NOT NULL,
    requester VARCHAR(255) NOT NULL,
    date DATE NOT NULL DEFAULT (CURRENT_DATE),
    priority VARCHAR(20) NOT NULL CHECK (priority IN ('Low', 'Medium', 'High')),
    status VARCHAR(30) NOT NULL CHECK (status IN ('Pending', 'Evaluating', 'Approved', 'Completed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requester) REFERENCES users(email) ON UPDATE CASCADE ON DELETE RESTRICT
);
 
-- Create index on status and requester for filtering/lookups
CREATE INDEX idx_change_requests_status ON change_requests(status);
CREATE INDEX idx_change_requests_requester ON change_requests(requester);
 
-- -------------------------------------------------------------
-- Seed Data
-- -------------------------------------------------------------
 
-- Seed Roles
INSERT INTO roles (name) VALUES
('Admin'),
('User'),
('Hod');
 
-- Seed Departments
INSERT INTO departments (name) VALUES
('General'),
('PED'),
('QAD'),
('Production'),
('Maintenance'),
('PC & L'),
('Materials'),
('Marketing'),
('HR'),
('Safety'),
('Unit Head');
 
 
 
-- Seed users (quick-login roles matching mockup)
INSERT INTO users (email, password, role, name, department, status) VALUES
('suriyaiyyanar10@gmail.com', 'admin123', 'Admin', 'Admin User', 'General', 'Active');

-- No initial change requests seeded
 
 
-- 3. Effectiveness Logs Table
CREATE TABLE effectiveness_logs (
    id VARCHAR(50) PRIMARY KEY, -- e.g. 'EFF-001'
    change_no VARCHAR(50) NOT NULL,
    req_date DATE NOT NULL,
    context VARCHAR(255) NOT NULL DEFAULT '',
    start_date DATE NOT NULL,
    month_wise VARCHAR(20) NOT NULL DEFAULT '',
    remarks TEXT,
    attachment TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT '',
    qa_approval VARCHAR(50) NOT NULL DEFAULT '',
    qa_update_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (change_no) REFERENCES change_requests(id) ON UPDATE CASCADE ON DELETE CASCADE
);
 
-- 4. Effectiveness Attachments Table
CREATE TABLE effectiveness_attachments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    log_id VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_data LONGTEXT NOT NULL, -- stores base64 data
    file_type VARCHAR(100) NOT NULL, -- e.g. 'application/pdf', 'image/png'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (log_id) REFERENCES effectiveness_logs(id) ON UPDATE CASCADE ON DELETE CASCADE
);
 
-- 5. Notifications Table
CREATE TABLE notifications (
    id VARCHAR(255) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    details TEXT NOT NULL,
    change_no VARCHAR(50) NOT NULL DEFAULT '',
    category VARCHAR(255) NOT NULL DEFAULT '',
    dept VARCHAR(100) NOT NULL DEFAULT '',
    time_str VARCHAR(100) NOT NULL DEFAULT '',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    type VARCHAR(100) NOT NULL DEFAULT '',
    color VARCHAR(20) NOT NULL DEFAULT '',
    recipient_email VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
 
-- No initial notifications seeded
 
-- No initial effectiveness logs seeded
 
-- No initial effectiveness attachments seeded
 
-- 6. L1 Requests Table
CREATE TABLE l1_requests (
    change_no VARCHAR(50) PRIMARY KEY,
    unit VARCHAR(100) NOT NULL,
    requested_time VARCHAR(20) NOT NULL,
    change_in VARCHAR(255) NOT NULL DEFAULT '',
    dept VARCHAR(100) NOT NULL,
    request_by VARCHAR(100) NOT NULL,
    process_name VARCHAR(100) NOT NULL,
    process_line VARCHAR(100) NOT NULL,
    machine_no VARCHAR(100) NOT NULL,
    description LONGTEXT NOT NULL,
    improvement_area VARCHAR(100) NOT NULL,
    change_type VARCHAR(100) NOT NULL,
    date_start DATE,
    opening_quantity INT NULL,
    trace_from TEXT NOT NULL,
    date_close DATE,
    closed_quantity INT NULL,
    trace_to TEXT NOT NULL,
    risk_analysis TEXT NOT NULL,
    sop_update TEXT NOT NULL,
    hod_approval TEXT NOT NULL,
    customer_approval VARCHAR(100) NOT NULL,
    effectiveness_monitoring TEXT NOT NULL,
    file_desc TEXT NOT NULL,
    file_improvement TEXT NOT NULL,
    file_trace_from TEXT NOT NULL,
    file_trace_to TEXT NOT NULL,
    file_risk TEXT NOT NULL,
    file_sop TEXT NOT NULL,
    file_effectiveness TEXT NOT NULL,
    improvement_table_data LONGTEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (change_no) REFERENCES change_requests(id) ON UPDATE CASCADE ON DELETE CASCADE
);
 
-- 6a. L1 Attachments Table
CREATE TABLE l1_attachments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    change_no VARCHAR(50) NOT NULL,
    field_name VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_data LONGTEXT NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (change_no) REFERENCES l1_requests(change_no) ON UPDATE CASCADE ON DELETE CASCADE
);
 
-- 7. L2 Validation Logs Table
CREATE TABLE l2_validation_logs (
    change_no VARCHAR(50) PRIMARY KEY,
    validation_date VARCHAR(50) NOT NULL,
    requester VARCHAR(255) NOT NULL,
    weld_test TEXT NOT NULL,
    qa_test TEXT NOT NULL,
    status VARCHAR(50) NOT NULL,
    remarks TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (change_no) REFERENCES change_requests(id) ON UPDATE CASCADE ON DELETE CASCADE
);
 
-- 7a. L2 Attachments Table
CREATE TABLE l2_attachments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    change_no VARCHAR(50) NOT NULL,
    field_name VARCHAR(50) NOT NULL, -- 'weld_test' or 'qa_test'
    file_name VARCHAR(255) NOT NULL,
    file_data LONGTEXT NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (change_no) REFERENCES l2_validation_logs(change_no) ON UPDATE CASCADE ON DELETE CASCADE
);
 
-- 8. L3 Approvals Table
CREATE TABLE l3_approvals (
    change_no VARCHAR(50) PRIMARY KEY,
    date VARCHAR(50) NOT NULL,
    requester VARCHAR(255) NOT NULL,
    ped VARCHAR(50) NOT NULL DEFAULT 'Pending',
    qad VARCHAR(50) NOT NULL DEFAULT 'Pending',
    production VARCHAR(50) NOT NULL DEFAULT 'Pending',
    maintenance VARCHAR(50) NOT NULL DEFAULT 'Pending',
    pcl VARCHAR(50) NOT NULL DEFAULT 'Pending',
    materials VARCHAR(50) NOT NULL DEFAULT 'Pending',
    marketing VARCHAR(50) NOT NULL DEFAULT 'Pending',
    hr VARCHAR(50) NOT NULL DEFAULT 'Pending',
    safety VARCHAR(50) NOT NULL DEFAULT 'Pending',
    unit_head VARCHAR(50) NOT NULL DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (change_no) REFERENCES change_requests(id) ON UPDATE CASCADE ON DELETE CASCADE
);
 
-- 9. HOD Approvals Table
CREATE TABLE hod_approvals (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    change_no  VARCHAR(50) NOT NULL,
    hod_email  VARCHAR(255) NOT NULL,
    hod_dept   VARCHAR(100) NOT NULL,
    status     VARCHAR(50) NOT NULL DEFAULT 'Pending',
    remarks    TEXT,
    decided_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_change_dept (change_no, hod_dept),
    FOREIGN KEY (change_no) REFERENCES change_requests(id) ON UPDATE CASCADE ON DELETE CASCADE
);
 
SET FOREIGN_KEY_CHECKS = 1;