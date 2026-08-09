<?php
/**
 * Search form.
 *
 * @package Hotbox_Office
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$hotbox_search_id = wp_unique_id( 'hb-search-' );
?>
<form role="search" method="get" class="hb-search-form" action="<?php echo esc_url( home_url( '/' ) ); ?>">
	<label class="screen-reader-text" for="<?php echo esc_attr( $hotbox_search_id ); ?>"><?php esc_html_e( 'Search for:', 'hotbox-office' ); ?></label>
	<input type="search" id="<?php echo esc_attr( $hotbox_search_id ); ?>" name="s" value="<?php echo get_search_query(); ?>" placeholder="<?php esc_attr_e( 'Search…', 'hotbox-office' ); ?>" />
	<button type="submit" class="hb-btn"><?php esc_html_e( 'Search', 'hotbox-office' ); ?></button>
</form>
