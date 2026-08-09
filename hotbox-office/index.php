<?php
/**
 * Main fallback template — blog index, archives, search.
 *
 * @package Hotbox_Office
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();
?>

<main id="primary" class="hb-main">
	<div class="hb-wrap">

		<div class="hb-page-title">
			<h1>
				<?php
				if ( is_home() && ! is_front_page() ) {
					single_post_title();
				} elseif ( is_search() ) {
					/* translators: %s: search query. */
					printf( esc_html__( 'Search: %s', 'hotbox-office' ), esc_html( get_search_query() ) );
				} elseif ( is_archive() ) {
					the_archive_title();
				} else {
					esc_html_e( 'Latest News', 'hotbox-office' );
				}
				?>
			</h1>
			<?php if ( is_archive() && get_the_archive_description() ) : ?>
				<div class="hb-sub"><?php the_archive_description(); ?></div>
			<?php endif; ?>
		</div>

		<?php if ( have_posts() ) : ?>

			<div class="hb-entry">
				<?php while ( have_posts() ) : ?>
					<?php the_post(); ?>
					<article id="post-<?php the_ID(); ?>" <?php post_class( 'hb-post' ); ?>>
						<div class="hb-post__meta"><?php echo esc_html( get_the_date() ); ?></div>
						<h2><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
						<?php if ( has_post_thumbnail() ) : ?>
							<a href="<?php the_permalink(); ?>"><?php the_post_thumbnail( 'large' ); ?></a>
						<?php endif; ?>
						<div class="hb-post__content"><?php the_excerpt(); ?></div>
						<a class="hb-btn hb-btn--ghost" href="<?php the_permalink(); ?>"><?php esc_html_e( 'Read more', 'hotbox-office' ); ?></a>
					</article>
				<?php endwhile; ?>
			</div>

			<nav class="hb-pagination" aria-label="<?php esc_attr_e( 'Posts navigation', 'hotbox-office' ); ?>">
				<?php echo wp_kses_post( paginate_links( array( 'type' => 'plain' ) ) ); ?>
			</nav>

		<?php else : ?>

			<div class="hb-entry">
				<p><?php esc_html_e( 'Nothing found here. Try a search, or head back to the front page.', 'hotbox-office' ); ?></p>
				<?php get_search_form(); ?>
			</div>

		<?php endif; ?>

	</div>
</main>

<?php
get_footer();
