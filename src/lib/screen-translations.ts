// Newly-wired UI strings for Settings, Profile, PMS, Dashboard chrome.
// English source bundle; other languages filled by the translation script.
export const screenTranslations: { [lang: string]: { [key: string]: string } } = {
  en: {
    // Dashboard
    'dashboard.workStatusAttendance': 'Work Status & Attendance',
    'dashboard.manageUsersShort': 'Users',

    // Account Settings dialog
    'settings.title': 'Account Settings',
    'settings.tabAccount': 'Account',
    'settings.tabNotifications': 'Notifications',
    'settings.tabSecurity': 'Security',
    'settings.accountInformation': 'Account Information',
    'settings.accountInformationDesc': 'View your account details and permissions',
    'settings.fullName': 'Full Name',
    'settings.nickname': 'Nickname',
    'settings.email': 'Email',
    'settings.role': 'Role',
    'settings.assignedHotel': 'Assigned Hotel',
    'settings.notSet': 'Not set',
    'settings.lastLogin': 'Last login',
    'settings.never': 'Never',
    'settings.changePassword': 'Change Password',
    'settings.changePasswordDesc': 'Update your account password',
    'settings.newPassword': 'New Password',
    'settings.enterNewPassword': 'Enter new password',
    'settings.confirmNewPassword': 'Confirm New Password',
    'settings.confirmNewPasswordPlaceholder': 'Confirm new password',
    'settings.updating': 'Updating...',
    'settings.updatePassword': 'Update Password',
    'settings.alternativeResetEmail': 'Alternative: Reset via Email',
    'settings.alternativeResetEmailDesc': 'Send a password reset link to your email address',
    'settings.sendResetEmail': 'Send Reset Email',
    'settings.securityInformation': 'Security Information',
    'settings.securityTip1': 'Your password should be at least 6 characters long',
    'settings.securityTip2': 'Use a mix of letters, numbers, and symbols for better security',
    'settings.securityTip3': 'Avoid using personal information in passwords',
    'settings.close': 'Close',

    // Edit Profile dialog
    'profile.title': 'Edit Profile',
    'profile.fullName': 'Full Name',
    'profile.enterFullName': 'Enter your full name',
    'profile.nickname': 'Nickname',
    'profile.enterNickname': 'Enter a nickname (optional)',
    'profile.email': 'Email',
    'profile.emailCannotChange': 'Email cannot be changed from here',
    'profile.cancel': 'Cancel',
    'profile.saving': 'Saving...',
    'profile.saveChanges': 'Save Changes',
    'profile.removePhoto': 'Remove Photo',

    // PMS Upload extra
    'pms.noHotelSelected': 'No Hotel Selected',
    'pms.selectHotelFirst': 'Please select a hotel from the switcher at the top to upload PMS data.',
    'pms.viewHistory': 'View History',

    // PMS Upload History dialog
    'pmsHistory.title': 'PMS Upload History',
    'pmsHistory.noHistory': 'No upload history found',
    'pmsHistory.pmsUpload': 'PMS Upload',
    'pmsHistory.completed': 'Completed',
    'pmsHistory.uploadedBy': 'Uploaded by',
    'pmsHistory.unknown': 'Unknown',
    'pmsHistory.processedRooms': 'Processed Rooms',
    'pmsHistory.updatedRooms': 'Updated Rooms',
    'pmsHistory.errors': 'Errors',
    'pmsHistory.andMoreErrors': '... and {count} more errors',
    'pmsHistory.hideRoomDetails': 'Hide Room Details',
    'pmsHistory.showRoomDetails': 'Show Room Details ({count} rooms)',

    // Tickets header (used in Dashboard.tsx tickets tab)
    'tickets.allTickets': 'All Tickets',
    'tickets.myTickets': 'My Tickets',
    'tickets.manageAllHotels': 'Manage tickets for all hotels',
    'tickets.manageFor': 'Manage tickets for',
    'tickets.assignedToYou': 'Tickets assigned to you',
    'tickets.searchTickets': 'Search tickets...',
    'tickets.noTicketsFound': 'No tickets found',
    'tickets.allStatusFilter': 'All Status',
    'tickets.allPriorityFilter': 'All Priority',
    'tickets.allDepartments': 'All Departments',

    // Late Minibar Additions (already wired via t() but missing keys in non-en)
    'minibar.lateAdditions': 'Late Minibar Additions',
    'minibar.lateAdditionsDesc': 'Items added by housekeepers after the room was already approved',
    'minibar.approveLate': 'Approve',
    'minibar.rejectLate': 'Remove',
    'minibar.lateApproved': 'Late minibar item approved',
    'minibar.lateRejected': 'Late minibar item removed',
    'minibar.addedAfterCompletion': 'Added after completion',
  },
};
