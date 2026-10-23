# Notification digest design

Digest delivery should aggregate notifications by recipient and send one
message per configured daily or weekly window. The job must select recipients
using their saved preference, group entries by notification type, and compute
the window in the recipient's timezone before enqueueing email work. Immediate
notifications remain the default when no digest preference is stored.
