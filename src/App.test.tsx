import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders Hello World heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /hello, world!/i })).toBeInTheDocument();
  });
});
