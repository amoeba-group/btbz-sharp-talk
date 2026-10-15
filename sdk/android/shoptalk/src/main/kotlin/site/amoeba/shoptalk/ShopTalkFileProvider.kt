package site.amoeba.shoptalk

import androidx.core.content.FileProvider

/**
 * Hands camera captures to the system camera app. A dedicated subclass (declared in the
 * library manifest with authority `${applicationId}.shoptalk.fileprovider`) so it can
 * never clash with a FileProvider the host app already declares.
 */
class ShopTalkFileProvider : FileProvider()
